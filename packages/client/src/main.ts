import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { PORT } from '@air-combat/shared';

// --- scena testowa: sześcian + światło (faza 0, do wyrzucenia w fazie 1) ---

const app = document.getElementById('app');
if (!app) throw new Error('brak elementu #app');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x10141c);

const camera = new PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0, 0);

const cube = new Mesh(
  new BoxGeometry(1, 1, 1),
  new MeshStandardMaterial({ color: 0x4a90d9 }),
);
scene.add(cube);

scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 5, 2);
scene.add(sun);

function resize(): void {
  const { clientWidth, clientHeight } = app as HTMLElement;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((time) => {
  cube.rotation.x = time / 2000;
  cube.rotation.y = time / 1300;
  renderer.render(scene, camera);
});

// --- klient WS: ping/pong + licznik RTT ---

const statusEl = document.getElementById('net-status');
if (!statusEl) throw new Error('brak elementu #net-status');

const PING_INTERVAL_MS = 1000;
const RECONNECT_DELAY_MS = 2000;

function connect(): void {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  let pingSentAt = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  ws.addEventListener('open', () => {
    statusEl!.textContent = 'połączono, czekam na pong…';
    const sendPing = (): void => {
      pingSentAt = performance.now();
      ws.send('ping');
    };
    sendPing();
    pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
  });

  ws.addEventListener('message', (event) => {
    if (event.data === 'pong') {
      const rtt = Math.round(performance.now() - pingSentAt);
      statusEl!.textContent = `pong (${rtt} ms)`;
    }
  });

  ws.addEventListener('close', () => {
    clearInterval(pingTimer);
    statusEl!.textContent = 'rozłączono — ponawiam…';
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}
connect();
