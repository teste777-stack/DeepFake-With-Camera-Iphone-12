const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const engineDir = path.join(root, 'face-engine');
const venvDir = path.join(engineDir, '.venv');
const requirements = path.join(engineDir, 'requirements.txt');

function run(command, args) {
  console.log('\n> ' + command + ' ' + args.join(' '));
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function findPython311() {
  if (process.platform === 'win32') {
    const result = spawnSync('py', ['-3.11', '--version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status === 0) return { command: 'py', args: ['-3.11'] };
    return null;
  }
  const result = spawnSync('python3.11', ['--version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status === 0) return { command: 'python3.11', args: [] };
  return null;
}

const python = findPython311();
if (!python) {
  console.error('\n[FACE ENGINE] Python 3.11 não foi encontrado.');
  console.error('Instale Python 3.11.x e depois rode: npm run face-engine:setup');
  process.exit(1);
}

const venvPython = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

if (!fs.existsSync(venvPython)) {
  console.log('[FACE ENGINE] Criando .venv com Python 3.11...');
  run(python.command, [...python.args, '-m', 'venv', venvDir]);
}

run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel']);

if (process.argv.includes('--install')) {
  if (!fs.existsSync(requirements)) {
    console.error('[FACE ENGINE] requirements.txt não encontrado.');
    process.exit(1);
  }
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', '-r', requirements]);
} else {
  console.log('\n[FACE ENGINE] Ambiente pronto.');
  console.log('Instalar dependências: npm run face-engine:install');
}

console.log('\n[FACE ENGINE] Python:', venvPython);
