const { customConsoleLog, waitForElement, wait } = require('../../preloadFunctions');
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

async function checkLinkedinCredentials(company, name) {
  const userData = await ipcRenderer.invoke('get-user-data-path');
  const linkedinCredentialsPath = path.join(
    userData,
    'exported_data',
    company,
    name,
    'linkedinCredentials.json',
  );

  const fileExists = await fs.existsSync(linkedinCredentialsPath);
  if (fileExists) {
    const fileContent = fs.readFileSync(linkedinCredentialsPath, 'utf-8');
    return JSON.parse(fileContent);
  }
  return null;
}

async function checkIfConnectionExists(id, platformId, company, name, connection) {
  const userData = await ipcRenderer.invoke('get-user-data-path');
  const filePath = path.join(
    userData,
    'exported_data',
    company,
    name,
    platformId,
    `${platformId}.json`,
  );
  
  const fileExists = await fs.existsSync(filePath);
  if (fileExists) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      if (fileContent.trim() === '') {
        customConsoleLog(id, 'File is empty');
        return false;
      }
      const savedConnections = JSON.parse(fileContent);
      if (savedConnections && savedConnections.content && Array.isArray(savedConnections.content)) {
        // Check if connection exists using createdAt timestamp
        return savedConnections.content.some(
          saved => saved.created_at === connection.created_at && 
            saved.first_name === connection.first_name
        );
      }
    } catch (error) {
      customConsoleLog(id, `Error reading or parsing file: ${error.message}`);
    }
  }
  return false;
}

async function exportLinkedin(id, platformId, filename, company, name) {
  let linkedinCredentials;
  if (!window.location.href.includes('linkedin.com')) {
    customConsoleLog(id, 'Navigating to LinkedIn');
    window.location.assign('https://linkedin.com/');
    ipcRenderer.send('get-linkedin-credentials', company, name);
  }

  while (!linkedinCredentials) {
    await wait(0.5);
    linkedinCredentials = await checkLinkedinCredentials(company, name);
  }

  customConsoleLog(id, 'linkedinCredentials obtained!');

  try {
    let consecutiveExisting = 0;
    let start = 0;
    const count = 40;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        'decorationId': 'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-15',
        'count': count.toString(),
        'q': 'search',
        'sortType': 'RECENTLY_ADDED',
        'start': start.toString()
      });

      const url = `https://www.linkedin.com/voyager/api/relationships/dash/connections?${params.toString()}`;
      customConsoleLog(id, `Fetching connections ${start} to ${start + count}`);

      const response = await fetch(url, {
        headers: {
          'cookie': linkedinCredentials.cookie,
          'csrf-token': linkedinCredentials.csrfToken,
        }
      });

      if (!response.ok) {
        throw new Error(`LinkedIn API request failed: ${response.status}`);
      }

      const data = await response.json();
      if (!data.elements || data.elements.length === 0) {
        hasMore = false;
      } else {
        for (const connection of data.elements) {
          const memberResult = connection?.connectedMemberResolutionResult;
          if (!memberResult?.firstName && !memberResult?.lastName && !memberResult?.headline) {
            continue;
          }
          
          const connectionData = {
            first_name: memberResult?.firstName || '',
            last_name: memberResult?.lastName || '',
            headline: memberResult?.headline || '',
            created_at: connection?.createdAt || ''
          };

          const connectionExists = await checkIfConnectionExists(
            id,
            platformId,
            company,
            name,
            connectionData
          );

          if (connectionExists) {
            customConsoleLog(id, 'Connection already exists, skipping');
            consecutiveExisting++;
            if (consecutiveExisting >= 3) {
              customConsoleLog(id, 'Found 3 consecutive existing connections, stopping export');
              hasMore = false;
              break;
            }
          } else {
            consecutiveExisting = 0;
            ipcRenderer.send(
              'handle-update',
              company,
              name,
              platformId,
              JSON.stringify(connectionData),
              id
            );
          }
        }
        
        start += count;
        await wait(1);
      }
    }

    ipcRenderer.send('handle-update-complete', id, platformId, company, name);
    return 'HANDLE_UPDATE_COMPLETE';
  } catch (error) {
    customConsoleLog(id, `Error fetching LinkedIn data: ${error.message}`);
    return 'NOTHING';
  }
}

module.exports = exportLinkedin;