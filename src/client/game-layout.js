const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 576;

const $ = (selector) => document.querySelector(selector);
const gameScreen = $('#game-screen');
const gameLayout = gameScreen?.querySelector('.game-layout');
const gameColumn = gameScreen?.querySelector('.game-column');
const canvasWrap = $('#game-canvas');
const socialPanel = gameScreen?.querySelector('.social-panel');

injectLayoutStyles();

function injectLayoutStyles() {
  if ($('#rabbit-game-layout-styles')) return;
  const style = document.createElement('style');
  style.id = 'rabbit-game-layout-styles';
  style.textContent = `
    /* v0.2.4 authoritative game-first layout */
    #game-screen:not(.hidden) {
      box-sizing: border-box !important;
      position: relative !important;
      height: calc(100dvh - 72px) !important;
      min-height: 0 !important;
      overflow: hidden !important;
      padding: 10px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
    }

    #game-screen:not(.hidden) .game-top-hud {
      flex: 0 0 auto !important;
      margin: 0 !important;
    }

    #game-screen:not(.hidden) .game-layout {
      position: relative !important;
      flex: 1 1 0 !important;
      width: 100% !important;
      height: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      display: block !important;
      overflow: hidden !important;
    }

    #game-screen:not(.hidden) .game-column {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      display: block !important;
      overflow: hidden !important;
    }

    #game-screen:not(.hidden) .game-canvas-wrap {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
      display: block !important;
      background: #9f6c5a !important;
    }

    #game-screen:not(.hidden) .pixel-game-canvas {
      position: absolute !important;
      left: 50% !important;
      top: 50% !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      transform: translate(-50%, -50%) !important;
      image-rendering: pixelated !important;
      image-rendering: crisp-edges !important;
    }

    /* Real HUD overlay: it never consumes game-layout width or height. */
    #game-screen:not(.hidden) .social-panel {
      position: fixed !important;
      right: 18px !important;
      bottom: 18px !important;
      z-index: 80 !important;
      width: 330px !important;
      height: 360px !important;
      max-width: calc(100vw - 36px) !important;
      max-height: min(360px, calc(100dvh - 190px)) !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }

    #game-screen:not(.hidden) .social-panel .chat-messages {
      min-height: 0 !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain !important;
    }

    #game-screen:not(.hidden) .social-panel.chat-collapsed {
      width: 172px !important;
      height: 50px !important;
      max-width: calc(100vw - 24px) !important;
      max-height: 50px !important;
      padding: 6px 8px !important;
      display: block !important;
    }

    #game-screen:not(.hidden) .social-panel.chat-collapsed #chat-messages,
    #game-screen:not(.hidden) .social-panel.chat-collapsed #chat-load-earlier,
    #game-screen:not(.hidden) .social-panel.chat-collapsed #chat-new-messages,
    #game-screen:not(.hidden) .social-panel.chat-collapsed #chat-form,
    #game-screen:not(.hidden) .social-panel.chat-collapsed .emote-grid,
    #game-screen:not(.hidden) .social-panel.chat-collapsed .control-help,
    #game-screen:not(.hidden) .social-panel.chat-collapsed #notification-toggle-btn,
    #game-screen:not(.hidden) .social-panel.chat-collapsed #chat-status,
    #game-screen:not(.hidden) .social-panel.chat-collapsed .eyebrow {
      display: none !important;
    }

    @media (max-width: 700px) {
      #game-screen:not(.hidden) {
        height: 100dvh !important;
        padding: 6px !important;
      }
      #game-screen:not(.hidden) .social-panel {
        right: 8px !important;
        bottom: 92px !important;
        width: min(320px, calc(100vw - 16px)) !important;
        height: min(300px, 46dvh) !important;
        max-height: 46dvh !important;
      }
      #game-screen:not(.hidden) .social-panel.chat-collapsed {
        width: 160px !important;
        height: 48px !important;
        max-height: 48px !important;
      }
    }
  `;
  document.head.append(style);
}

function fitCanvasCover() {
  const canvas = canvasWrap?.querySelector('canvas.pixel-game-canvas');
  if (!canvas || !canvasWrap) return;

  const width = canvasWrap.clientWidth;
  const height = canvasWrap.clientHeight;
  if (width <= 0 || height <= 0) return;

  // Cover, not contain: fill every pixel of the game viewport while preserving
  // the 960x576 world aspect ratio. Excess edges are cropped by canvasWrap.
  const scale = Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT);
  const cssWidth = Math.ceil(WORLD_WIDTH * scale);
  const cssHeight = Math.ceil(WORLD_HEIGHT * scale);

  canvas.style.setProperty('width', `${cssWidth}px`, 'important');
  canvas.style.setProperty('height', `${cssHeight}px`, 'important');
}

function verifyLayout() {
  if (!gameScreen || gameScreen.classList.contains('hidden')) return;
  fitCanvasCover();

  // Defensive cleanup: old grid sizing must never participate in game sizing.
  gameLayout?.style.setProperty('grid-template-columns', 'none', 'important');
  gameColumn?.style.setProperty('min-height', '0', 'important');
  socialPanel?.style.setProperty('grid-column', 'auto', 'important');
}

if (canvasWrap) {
  const resizeObserver = new ResizeObserver(() => fitCanvasCover());
  resizeObserver.observe(canvasWrap);

  const canvasObserver = new MutationObserver(() => fitCanvasCover());
  canvasObserver.observe(canvasWrap, { childList: true });
}

if (gameScreen) {
  const screenObserver = new MutationObserver(() => {
    if (!gameScreen.classList.contains('hidden')) requestAnimationFrame(verifyLayout);
  });
  screenObserver.observe(gameScreen, { attributes: true, attributeFilter: ['class'] });
}

window.addEventListener('resize', () => requestAnimationFrame(verifyLayout));
window.addEventListener('orientationchange', () => setTimeout(verifyLayout, 120));
requestAnimationFrame(verifyLayout);
