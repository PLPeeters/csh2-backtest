import './app.css';

function showStartupFailure(error: unknown) {
  console.error(error);
  const target = document.getElementById('app');
  if (!target) return;
  const failure = document.createElement('pre');
  failure.style.cssText = 'margin:16px;padding:16px;overflow:auto;border:1px solid #a52f24;border-radius:6px;background:#fff7f6;color:#76251e;white-space:pre-wrap';
  failure.textContent = `The application could not start.\n\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  target.replaceChildren(failure);
}

async function start() {
  const [{ mount }, { default: App }] = await Promise.all([import('svelte'), import('./App.svelte')]);
  const target = document.getElementById('app');
  if (!target) throw new Error('The application mount point is missing.');
  mount(App, { target });
}

void start().catch(showStartupFailure);
