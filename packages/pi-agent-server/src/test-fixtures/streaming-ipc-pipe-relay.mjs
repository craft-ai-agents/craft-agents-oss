// Node's paused pipe stops native reads. Bun's child-process wrapper can keep
// draining its OS pipe after .pause(), so it cannot exercise a blocked writer.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.argv[2], process.argv.slice(3), { stdio: ['pipe', 'pipe', 'pipe'] });
child.on('error', error => process.stderr.write(`Relay child failed: ${error.message}\n`));
child.stdin.on('error', () => child.kill('SIGKILL'));
child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.pipe(process.stderr);
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === '__pause_reader__') child.stdout.pause();
  else if (message.type === '__resume_reader__') child.stdout.resume();
  else child.stdin.write(line + '\n');
}).on('close', () => child.kill('SIGKILL'));
child.on('close', code => process.exit(code ?? 1));
process.on('SIGTERM', () => child.kill('SIGKILL'));
