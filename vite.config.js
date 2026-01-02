import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { execSync } from 'child_process'

// Get git info at build time
function getGitInfo() {
  try {
    const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
    const commitDate = execSync('git log -1 --format=%ci').toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    return { commitHash, commitDate, branch };
  } catch (e) {
    return { commitHash: 'unknown', commitDate: new Date().toISOString(), branch: 'unknown' };
  }
}

const gitInfo = getGitInfo();

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    react(),
  ],
  define: {
    __GIT_COMMIT__: JSON.stringify(gitInfo.commitHash),
    __GIT_COMMIT_DATE__: JSON.stringify(gitInfo.commitDate),
    __GIT_BRANCH__: JSON.stringify(gitInfo.branch),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
