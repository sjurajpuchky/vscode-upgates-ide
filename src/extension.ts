import * as vscode from 'vscode';
import * as request from 'request';
import * as fs from 'fs';
import * as path from 'path';

interface AuthConfig {
    apiUrl: string;
    auth: string;
}

interface ItemRecord {
    pathname: string;
    type: string;
}

class APIError extends Error {
    errors: any[] | undefined;

    constructor(message: string, errors?: any[]) {
        super(message);
        this.errors = errors;
        Object.setPrototypeOf(this, APIError.prototype);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('UpGates deployment LOG');

    // Register commands
    const commands = [
        {command: 'extension.createProject', callback: createProjectDisposal},
        {command: 'extension.deployFile', callback: deployFileDisposal},
        {command: 'extension.downloadFolder', callback: downloadFolderDisposal},
        {command: 'extension.downloadFile', callback: downloadFileDisposal},
        {command: 'extension.deployFolder', callback: deployFolderDisposal},
        {command: 'extension.createFolder', callback: createFolderDisposal},
        {command: 'extension.createFile', callback: createFileDisposal}
    ];

    commands.forEach(({command, callback}) => {
        const disposable = vscode.commands.registerCommand(command, callback.bind(null, outputChannel));
        context.subscriptions.push(disposable);
    });
}

async function getRootPath(): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error("Please open a folder first.");
    }

    return workspaceFolders[0].uri.fsPath;
}

async function getAuthConfig(rootPath: string, outputChannel: vscode.OutputChannel): Promise<AuthConfig | null> {
    const authFilePath = path.join(rootPath, 'auth.json');

    if (fs.existsSync(authFilePath)) {
        outputChannel.appendLine('Found existing auth.json');
        const authFileContent = fs.readFileSync(authFilePath, 'utf8');
        return JSON.parse(authFileContent);
    } else {
        outputChannel.appendLine('auth.json not found, requesting credentials...');
        const authConfig = await getCredentials(outputChannel);

        if (!authConfig) {
            throw new Error('API credentials are required.');
        }

        fs.writeFileSync(authFilePath, JSON.stringify(authConfig, null, 2), 'utf8');
        outputChannel.appendLine('Saved credentials to auth.json');
        return authConfig;
    }
}

async function createProjectDisposal(outputChannel: vscode.OutputChannel) {
    try {
        const rootPath = await getRootPath();
        const authConfig = await getAuthConfig(rootPath, outputChannel);
        if (!authConfig) {
            return;
        }
        const files = await fetchListOfFiles(authConfig.apiUrl, authConfig.auth, outputChannel);
        outputChannel.appendLine(`Files to download: ${files.length}`);
        for (const file of files) {
            await downloadFileFromApi(authConfig.apiUrl, authConfig.auth, file, rootPath, outputChannel);
        }
        vscode.window.showInformationMessage('Project downloaded successfully.');
        outputChannel.appendLine('Project downloaded successfully.');
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function deployFileDisposal(outputChannel: vscode.OutputChannel, uri: vscode.Uri) {
    try {
        const rootPath = await getRootPath();
        const authConfig = await getAuthConfig(rootPath, outputChannel);
        if (!authConfig) {
            return;
        }
        await deployFileToApi(authConfig.apiUrl, authConfig.auth, rootPath, uri.fsPath, outputChannel);
        vscode.window.showInformationMessage(`File ${path.basename(uri.fsPath)} deployed successfully.`);
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function downloadFolderDisposal(outputChannel: vscode.OutputChannel, uri: vscode.Uri) {
    try {
        const rootPath = await getRootPath();
        const authConfig = await getAuthConfig(rootPath, outputChannel);
        if (!authConfig) {
            return;
        }
        await downloadFolderFromApi(authConfig.apiUrl, authConfig.auth, rootPath, uri.fsPath, outputChannel);
        vscode.window.showInformationMessage(`Folder ${path.basename(uri.fsPath)} downloaded successfully.`);
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function downloadFileDisposal(outputChannel: vscode.OutputChannel, uri: vscode.Uri) {
    try {
        const rootPath = await getRootPath();
        const authConfig = await getAuthConfig(rootPath, outputChannel);
        if (!authConfig) {
            return;
        }
        await downloadFileFromApi(authConfig.apiUrl, authConfig.auth, uri.fsPath.substring(rootPath.length), rootPath, outputChannel);
        vscode.window.showInformationMessage(`File ${path.basename(uri.fsPath)} downloaded successfully.`);
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function deployFolderDisposal(outputChannel: vscode.OutputChannel, uri: vscode.Uri) {
    try {
        const rootPath = await getRootPath();
        const authConfig = await getAuthConfig(rootPath, outputChannel);
        if (!authConfig) {
            return;
        }
        await deployFolderToApi(authConfig.apiUrl, authConfig.auth, rootPath, uri.fsPath, outputChannel);
        vscode.window.showInformationMessage(`Folder ${path.basename(uri.fsPath)} deployed successfully.`);
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function createFolderDisposal(outputChannel: vscode.OutputChannel, uri: vscode.Uri) {
    try {
        outputChannel.show();
        outputChannel.appendLine(`Creating folder in ${uri.fsPath}`);
        await createFolder(uri, outputChannel);
        vscode.window.showInformationMessage(`Folder in ${path.basename(uri.fsPath)} created successfully.`);
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function createFileDisposal(outputChannel: vscode.OutputChannel, uri: vscode.Uri) {
    try {
        outputChannel.show();
        outputChannel.appendLine(`Creating file in ${uri.fsPath}`);
        await createFile(uri, outputChannel);
        vscode.window.showInformationMessage(`File in ${path.basename(uri.fsPath)} created successfully.`);
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function getCredentials(outputChannel: vscode.OutputChannel): Promise<AuthConfig | null> {
    const apiUrl = await vscode.window.showInputBox({prompt: 'Enter API URL', ignoreFocusOut: true});
    if (!apiUrl) {
        outputChannel.appendLine('API URL not provided');
        return null;
    }
    outputChannel.appendLine(`API URL: ${apiUrl}`);

    const username = await vscode.window.showInputBox({prompt: 'Enter API Username', ignoreFocusOut: true});
    if (!username) {
        outputChannel.appendLine('API Username not provided');
        return null;
    }
    outputChannel.appendLine(`API Username: ${username}`);

    const password = await vscode.window.showInputBox({
        prompt: 'Enter API Password',
        password: true,
        ignoreFocusOut: true
    });
    if (!password) {
        outputChannel.appendLine('API Password not provided');
        return null;
    }
    outputChannel.appendLine('API Password: *****');

    const auth = "Basic " + Buffer.from(username + ":" + password).toString("base64");
    return {apiUrl, auth};
}

async function fetchListOfFiles(apiUrl: string, auth: string, outputChannel: vscode.OutputChannel): Promise<string[]> {
    outputChannel.appendLine('Fetching list of files...');
    const files: string[] = [];
    const directories: string[] = [''];

    while (directories.length > 0) {
        const currentDir = directories.pop() ?? '';
        outputChannel.appendLine(`Fetching directory: ${currentDir}`);
        try {
            const dirFiles: ItemRecord[] = await fetchDirectoryFiles(apiUrl, auth, currentDir, outputChannel);
            for (const file of dirFiles) {
                if (file.type === 'directory') {
                    directories.push(file.pathname);
                } else {
                    files.push(file.pathname);
                }
            }
        } catch (error) {
            handleError(error, outputChannel);
        }
    }

    return files;
}

async function fetchDirectoryFiles(apiUrl: string, auth: string, dirPath: string, outputChannel: vscode.OutputChannel): Promise<ItemRecord[]> {
    return new Promise<ItemRecord[]>((resolve, reject) => {
        request({
            url: `${apiUrl}/graphics/code?pathname=${dirPath}`,
            headers: {
                "Authorization": auth
            }
        }, (error, response, body) => {
            if (error) {
                outputChannel.appendLine(`Error: ${error.message}`);
                return reject(new APIError(`Error: ${error.message}`, undefined));
            }

            if (response.statusCode != 200) {
                return reject(new APIError(`Failed with status code: ${response.statusCode}`, undefined));
            } else {
                const parsedBody = JSON.parse(body);
                if (parsedBody.success === false) {
                    return reject(new APIError("Operation error", parsedBody.errors));
                    return
                }
            }

            try {
                const items: ItemRecord[] = JSON.parse(body).items;
                outputChannel.appendLine(`Fetched directory: ${dirPath}`);
                resolve(items);
            } catch (parseError) {
                return reject(new APIError('Failed to parse response body', undefined))
            }
        });
    });
}

async function downloadFileFromApi(apiUrl: string, auth: string, filePath: string, rootPath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine(`Downloading file: ${filePath}`);
    return new Promise<void>((resolve, reject) => {
        request({
            url: `${apiUrl}/graphics/code?pathname=${filePath}`,
            headers: {
                "Authorization": auth
            }
        }, (error: any, response: any, body: any) => {

            if (error) {
                outputChannel.appendLine(`Error: ${error.message}`);
                return reject(new APIError(`Error: ${error.message}`, undefined));
            }

            if (response.statusCode != 200) {
                return reject(new APIError(`Failed with status code: ${response.statusCode}`, undefined));
            } else {
                const parsedBody = JSON.parse(body);
                if (parsedBody.success === false) {
                    return reject(new APIError("Operation error", parsedBody.errors));
                }
            }

            try {
                const parsedBody = JSON.parse(body);
                const localPath = path.join(rootPath, filePath);
                fs.mkdirSync(path.dirname(localPath), {recursive: true});
                fs.writeFileSync(localPath, parsedBody.content, 'utf8');
                outputChannel.appendLine(`Downloaded file: ${filePath}`);
                resolve();
            } catch (parseError) {
                return reject(new APIError('Failed to parse response body', undefined))
            }
        });
    });
}

async function deployFileToApi(apiUrl: string, auth: string, rootPath: string, filePath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) {
                outputChannel.appendLine(`Error reading file: ${err.message}`);
                return reject(new APIError(`Error reading file: ${err.message}`, undefined))
            }

            const data = {
                pathname: filePath.substring(rootPath.length),
                content: content
            };

            request({
                method: 'PUT',
                url: `${apiUrl}/graphics/code`,
                headers: {
                    "Authorization": auth,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(data)
            }, (error: any, response: any, body: any) => {
                if (error) {
                    outputChannel.appendLine(`Error: ${error.message}`);
                    return reject(new APIError(`Error: ${error.message}`, undefined));
                }

                if (response.statusCode != 200) {
                    return reject(new APIError(`Failed with status code: ${response.statusCode}`, undefined));
                } else {
                    const parsedBody = JSON.parse(body);
                    if (parsedBody.success === false) {
                        return reject(new APIError("Operation error", parsedBody.errors));

                    }
                }

                outputChannel.appendLine(`File deployed successfully: ${filePath}`);
                resolve();
            });
        });
    });
}

async function createFolder(uri: vscode.Uri, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.show();
    outputChannel.appendLine(`Creating folder on API: ${uri.fsPath}`);

    const folderName = await vscode.window.showInputBox({prompt: 'Enter folder name', ignoreFocusOut: true});
    if (!folderName) {
        vscode.window.showErrorMessage('Folder name is required.');
        return;
    }

    const folderPath = path.join(uri.fsPath, folderName);

    fs.mkdirSync(folderPath, {recursive: true});
    outputChannel.appendLine(`Created folder: ${folderPath}`);

    const rootPath = await getRootPath();
    const authConfig = await getAuthConfig(rootPath, outputChannel);
    if (!authConfig) {
        return;
    }
    await createFolderOnApi(authConfig.apiUrl, authConfig.auth, rootPath, folderPath, outputChannel);
}

async function createFile(uri: vscode.Uri, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.show();
    outputChannel.appendLine(`Creating file on API: ${uri.fsPath}`);

    const fileName = await vscode.window.showInputBox({prompt: 'Enter file name', ignoreFocusOut: true});
    if (!fileName) {
        vscode.window.showErrorMessage('File name is required.');
        return;
    }

    const filePath = path.join(uri.fsPath, fileName);

    fs.writeFileSync(filePath, '', 'utf8');
    outputChannel.appendLine(`Created file: ${filePath}`);


    const rootPath = await getRootPath();
    const authConfig = await getAuthConfig(rootPath, outputChannel);
    if (!authConfig) {
        return;
    }
    await createFileOnApi(authConfig.apiUrl, authConfig.auth, rootPath, filePath, outputChannel);
}

async function deployFolderToApi(apiUrl: string, auth: string, rootPath: string, folderPath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine(`Deploying folder: ${folderPath}`);

    const deployFileInFolder = async (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                await deployFileInFolder(fullPath);
            } else {
                await deployFileToApi(apiUrl, auth, rootPath, fullPath, outputChannel);
            }
        }
    };


    await deployFileInFolder(folderPath);
    outputChannel.appendLine(`Folder ${folderPath} deployed successfully.`);
}

async function downloadFolderFromApi(apiUrl: string, auth: string, rootPath: string, folderPath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine(`Downloading folder: ${folderPath}`);

    const deployFileInFolder = async (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                await deployFileInFolder(fullPath);
            } else {
                await downloadFileFromApi(apiUrl, auth, fullPath.substring(rootPath.length), rootPath, outputChannel);
            }
        }
    };

    try {
        await deployFileInFolder(folderPath);
        outputChannel.appendLine(`Folder ${folderPath} downloaded successfully.`);
    } catch (error) {
        handleError(error, outputChannel);
    }
}

async function createFolderOnApi(apiUrl: string, auth: string, rootPath: string, folderPath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine(`Creating folder on API: ${folderPath}`);

    const data = {
        pathname: folderPath.substring(rootPath.length),
        type: 'directory'
    };

    return new Promise<void>((resolve, reject) => {
        request({
            method: 'POST',
            url: `${apiUrl}/graphics/code`,
            headers: {
                "Authorization": auth,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        }, (error, response, body) => {
            if (error) {
                outputChannel.appendLine(`Error: ${error.message}`);
                return reject(new APIError(`Error: ${error.message}`, undefined));
                return
            }

            if (response.statusCode != 200) {
                return reject(new APIError(`Failed with status code: ${response.statusCode}`, undefined));
                return
            } else {
                const parsedBody = JSON.parse(body);
                if (parsedBody.success === false) {
                    return reject(new APIError("Operation error", parsedBody.errors));
                    return
                }
            }

            outputChannel.appendLine(`Folder ${folderPath} created on API successfully.`);
            resolve();
        });
    });
}

async function createFileOnApi(apiUrl: string, auth: string, rootPath: string, filePath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine(`Creating file on API: ${filePath}`);

    const data = {
        pathname: filePath.substring(rootPath.length),
        type: 'file',
        content: ''
    };

    return new Promise<void>((resolve, reject) => {
        request({
            method: 'POST',
            url: `${apiUrl}/graphics/code`,
            headers: {
                "Authorization": auth,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        }, (error, response, body) => {
            if (error) {
                outputChannel.appendLine(`Error: ${error.message}`);
                return reject(new APIError(`Error: ${error.message}`, undefined));
            }

            if (response.statusCode != 200) {
                return reject(new APIError(`Failed with status code: ${response.statusCode}`, undefined));
            } else {
                const parsedBody = JSON.parse(body);
                if (parsedBody.success === false) {
                    return reject(new APIError("Operation error", parsedBody.errors));
                    return
                }
            }

            outputChannel.appendLine(`File ${filePath} created on API successfully.`);
            resolve();
        });
    });
}

function handleError(error: any, outputChannel: vscode.OutputChannel) {
    if (error instanceof APIError) {
        if (error.errors) {
            error.errors.forEach((e: any) => {
                outputChannel.appendLine(`${e.type}: ${e.message} at ${e.line}`);
            });
        }
        outputChannel.appendLine(`Error: ${error.message}`);
        vscode.window.showErrorMessage(`Error: ${error.message}`);
    } else {
        outputChannel.appendLine(`Error: ${error.message}`);
        vscode.window.showErrorMessage(`Error: ${error.message}`);
    }
}

export function deactivate() {
}
