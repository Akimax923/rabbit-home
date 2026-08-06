const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export const APPEARANCE_OPTIONS = {
  headAccessory: [
    ['none', '不戴头饰'], ['bow', '红色蝴蝶结'], ['flower', '小花'], ['leaf', '嫩叶'],
    ['cap', '小红帽'], ['crown', '迷你皇冠'], ['sleepcap', '睡帽'], ['carrot', '胡萝卜发卡'],
  ],
  neckAccessory: [
    ['none', '无颈饰'], ['scarf', '暖色围巾'], ['bell', '小铃铛'], ['bowtie', '小领结'], ['collar', '软软项圈'],
  ],
  backAccessory: [
    ['none', '无背饰'], ['mini-bag', '迷你挎包'], ['heart', '爱心背包'], ['cloud', '云朵背饰'], ['basket', '胡萝卜篮'],
  ],
  faceMark: [
    ['none', '自然脸'], ['blush', '粉色腮红'], ['patch', '小创可贴'], ['star', '星星贴纸'],
  ],
};

export function renderAvatarPreview(canvas, avatar) {
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const cssSize = 190;
  canvas.width = Math.round(cssSize * ratio);
  canvas.height = Math.round(cssSize * ratio);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cssSize, cssSize);
  drawPreviewBackground(ctx, cssSize);
  drawPixelAvatar(ctx, avatar, cssSize / 2, 139, { scale: 3.2, behavior: 'IDLE', direction: 'down', time: performance.now() });
}

function drawPreviewBackground(ctx, size) {
  ctx.fillStyle = '#f9e8cf';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 12) {
    for (let x = (y / 12) % 2 ? 6 : 0; x < size; x += 12) {
      ctx.fillStyle = 'rgba(152,91,62,.06)';
      ctx.fillRect(x, y, 6, 6);
    }
  }
  ctx.fillStyle = '#e6b983';
  ctx.fillRect(25, 144, 140, 8);
  ctx.fillStyle = '#c98762';
  ctx.fillRect(35, 152, 120, 4);
}

export function drawPixelAvatar(ctx, avatar, x, footY, options = {}) {
  if (!avatar) return;
  const scale = options.scale || 2;
  const behavior = options.behavior || avatar.behavior || 'IDLE';
  const direction = options.direction || avatar.direction || 'down';
  const time = options.time || 0;
  const moving = options.moving ?? avatar.moving;
  const selected = options.selected === true;
  const opacity = options.opacity ?? 1;

  const frame = Math.floor(time / 170) % 4;
  const bob = moving && behavior === 'WALK' ? (frame % 2 ? -1 : 0) : 0;
  const sitOffset = behavior === 'SIT' ? 3 : 0;
  const sleep = behavior === 'SLEEP';
  const bath = behavior === 'BATH';

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(Math.round(x), Math.round(footY + bob + sitOffset));
  if (selected) {
    ctx.fillStyle = 'rgba(255,245,192,.7)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 19 * scale / 2, 6 * scale / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.scale(scale, scale);
  ctx.translate(-16, -32);

  if (sleep) drawSleepingAvatar(ctx, avatar, frame);
  else if (bath) drawBathAvatar(ctx, avatar, frame);
  else if (avatar.role === 'MAOMAO') drawMaomao(ctx, avatar, direction, behavior, frame);
  else drawRabbit(ctx, avatar, direction, behavior, frame);

  drawAccessories(ctx, avatar, direction, behavior, frame);
  ctx.restore();
}

function drawRabbit(ctx, avatar, direction, behavior, frame) {
  const outline = '#5a302d';
  const body = avatar.primaryColor || '#f4ead7';
  const patch = avatar.secondaryColor || '#d9a879';
  const eye = avatar.eyeColor || '#342a2a';
  const sit = behavior === 'SIT' || behavior === 'BRUSH';
  const side = direction === 'left' || direction === 'right';
  const flip = direction === 'left';

  if (flip) { ctx.translate(32, 0); ctx.scale(-1, 1); }

  // shadow
  px(ctx, 8, 28, 17, 2, '#c18f76', .35);

  // ears, kept inside one stable 32x32 frame
  if (avatar.variant === 'lop') {
    px(ctx, 6, 6, 5, 13, outline); px(ctx, 7, 7, 3, 11, patch);
    px(ctx, 22, 7, 5, 13, outline); px(ctx, 23, 8, 3, 10, patch);
  } else {
    px(ctx, 9, 2, 5, 13, outline); px(ctx, 10, 3, 3, 10, patch);
    px(ctx, 19, 2, 5, 13, outline); px(ctx, 20, 3, 3, 10, patch);
  }

  if (avatar.variant === 'lion') {
    px(ctx, 5, 12, 23, 14, outline);
    px(ctx, 6, 11, 5, 4, body); px(ctx, 21, 11, 5, 4, body);
    px(ctx, 4, 16, 4, 7, body); px(ctx, 24, 16, 4, 7, body);
  }

  // body and head, rounded by stepped rectangles
  px(ctx, 7, sit ? 17 : 15, 19, sit ? 11 : 13, outline);
  px(ctx, 5, 17, 23, 8, outline);
  px(ctx, 7, 13, 19, 14, outline);
  px(ctx, 8, 12, 17, 15, body);
  px(ctx, 6, 17, 21, 7, body);
  px(ctx, 9, 11, 15, 3, body);
  px(ctx, side ? 17 : 9, 15, side ? 6 : 7, 5, patch);

  // feet / motion
  if (!sit) {
    const leg = frame % 2;
    px(ctx, 8 + leg, 26, 7, 3, outline); px(ctx, 18 - leg, 26, 7, 3, outline);
    px(ctx, 9 + leg, 26, 5, 2, body); px(ctx, 19 - leg, 26, 5, 2, body);
  } else {
    px(ctx, 8, 25, 7, 3, outline); px(ctx, 19, 25, 6, 3, outline);
  }

  drawFace(ctx, avatar, direction, eye, body);
  if (flip) { ctx.scale(-1, 1); ctx.translate(-32, 0); }
}

function drawMaomao(ctx, avatar, direction, behavior, frame) {
  const outline = '#58322f';
  const body = avatar.primaryColor || '#f2ead8';
  const patch = avatar.secondaryColor || '#d8c29f';
  const eye = avatar.eyeColor || '#342a2a';
  const sit = behavior === 'SIT' || behavior === 'BRUSH';
  const flip = direction === 'left';
  if (flip) { ctx.translate(32, 0); ctx.scale(-1, 1); }

  px(ctx, 8, 28, 17, 2, '#c18f76', .35);
  // little tufts define the maomao silhouette
  px(ctx, 11, 7, 4, 5, outline); px(ctx, 15, 5, 4, 6, outline); px(ctx, 19, 7, 4, 5, outline);
  if (avatar.variant === 'cloud') {
    px(ctx, 5, 14, 24, 12, outline); px(ctx, 7, 11, 20, 16, body); px(ctx, 4, 17, 5, 6, body); px(ctx, 25, 17, 4, 6, body);
  } else {
    px(ctx, 6, 14, 22, 12, outline); px(ctx, 8, 11, 18, 16, body); px(ctx, 5, 17, 23, 7, body);
  }
  px(ctx, 10, 9, 13, 5, body);
  if (avatar.variant === 'chestnut') px(ctx, 8, 14, 8, 8, patch);
  if (avatar.variant === 'peach') { px(ctx, 19, 14, 6, 6, '#f4b4ad'); px(ctx, 8, 20, 4, 2, '#f3aaa8'); }
  if (avatar.variant === 'cream') px(ctx, 17, 15, 7, 5, patch);
  if (avatar.variant === 'cloud') px(ctx, 8, 13, 6, 4, '#ffffff');

  if (!sit) {
    const leg = frame % 2;
    px(ctx, 8 + leg, 25, 7, 4, outline); px(ctx, 19 - leg, 25, 6, 4, outline);
    px(ctx, 9 + leg, 25, 5, 3, body); px(ctx, 20 - leg, 25, 4, 3, body);
  } else {
    px(ctx, 8, 25, 7, 3, outline); px(ctx, 19, 25, 6, 3, outline);
  }
  drawFace(ctx, avatar, direction, eye, body);
  if (flip) { ctx.scale(-1, 1); ctx.translate(-32, 0); }
}

function drawFace(ctx, avatar, direction, eye) {
  const side = direction === 'left' || direction === 'right';
  const eyeY = 17;
  if (direction === 'up') {
    px(ctx, 13, 18, 3, 2, avatar.secondaryColor || '#c99778');
    px(ctx, 18, 18, 3, 2, avatar.secondaryColor || '#c99778');
    return;
  }
  if (side) {
    px(ctx, 20, eyeY, 2, 2, eye);
    px(ctx, 23, 20, 2, 1, '#7b4741');
  } else {
    px(ctx, 11, eyeY, 2, 2, eye); px(ctx, 20, eyeY, 2, 2, eye);
    px(ctx, 15, 20, 3, 2, '#7b4741'); px(ctx, 16, 22, 1, 1, '#7b4741');
  }
  if (avatar.faceMark === 'blush') { px(ctx, 8, 21, 3, 1, '#ef9996'); px(ctx, 22, 21, 3, 1, '#ef9996'); }
  if (avatar.faceMark === 'patch') { px(ctx, 21, 20, 4, 2, '#e7c58b'); px(ctx, 22, 19, 2, 4, '#e7c58b'); }
  if (avatar.faceMark === 'star') { px(ctx, 7, 18, 1, 3, '#f2c94c'); px(ctx, 6, 19, 3, 1, '#f2c94c'); }
}

function drawSleepingAvatar(ctx, avatar, frame) {
  const outline = '#58322f';
  const body = avatar.primaryColor || '#f4ead7';
  const patch = avatar.secondaryColor || '#d9a879';
  px(ctx, 4, 20, 25, 8, outline);
  px(ctx, 6, 18, 21, 9, body);
  px(ctx, 5, 21, 6, 5, patch);
  px(ctx, 22, 16, 6, 5, outline);
  px(ctx, 23, 17, 4, 3, body);
  px(ctx, 10, 21, 5, 1, '#58322f');
  px(ctx, 16, 21, 5, 1, '#58322f');
  if (frame % 2) px(ctx, 27, 11, 2, 2, '#8b6ca8');
}

function drawBathAvatar(ctx, avatar, frame) {
  const outline = '#58322f';
  const body = avatar.primaryColor || '#f4ead7';
  const patch = avatar.secondaryColor || '#d9a879';
  // head only; tub is drawn by game scene in front
  px(ctx, 8, 10, 17, 14, outline);
  px(ctx, 9, 9, 15, 14, body);
  if (avatar.role === 'RABBIT') {
    px(ctx, 10, 3, 4, 10, outline); px(ctx, 19, 3, 4, 10, outline);
    px(ctx, 11, 4, 2, 8, patch); px(ctx, 20, 4, 2, 8, patch);
  } else {
    px(ctx, 12, 5, 3, 5, outline); px(ctx, 16, 3, 3, 6, outline); px(ctx, 20, 5, 3, 5, outline);
  }
  drawFace(ctx, avatar, 'down', avatar.eyeColor || '#342a2a');
  if (frame % 2) { px(ctx, 5, 8, 3, 3, '#dff6ff'); px(ctx, 25, 5, 2, 2, '#dff6ff'); }
}

function drawAccessories(ctx, avatar, direction, behavior, frame) {
  const head = avatar.headAccessory || avatar.accessory || 'none';
  const neck = avatar.neckAccessory || 'none';
  const back = avatar.backAccessory || 'none';
  if (behavior === 'BATH') return;

  if (back === 'mini-bag') { px(ctx, direction === 'left' ? 20 : 5, 18, 6, 7, '#9a644c'); px(ctx, direction === 'left' ? 21 : 6, 19, 4, 5, '#d2a268'); }
  if (back === 'heart') { px(ctx, 5, 17, 3, 3, '#e75f66'); px(ctx, 8, 17, 3, 3, '#e75f66'); px(ctx, 6, 19, 4, 4, '#e75f66'); }
  if (back === 'cloud') { px(ctx, 4, 18, 8, 5, '#e7f6ff'); px(ctx, 6, 16, 4, 3, '#ffffff'); }
  if (back === 'basket') { px(ctx, 4, 18, 8, 7, '#a66a42'); px(ctx, 5, 16, 6, 3, '#d8944f'); px(ctx, 6, 14, 2, 4, '#f08b32'); }

  if (neck === 'scarf') { px(ctx, 8, 22, 17, 3, '#cf4f47'); px(ctx, 20, 24, 4, 5, '#cf4f47'); }
  if (neck === 'bell') { px(ctx, 14, 22, 5, 3, '#dcae35'); px(ctx, 16, 25, 1, 1, '#8c6430'); }
  if (neck === 'bowtie') { px(ctx, 11, 22, 5, 4, '#7d6eb2'); px(ctx, 18, 22, 5, 4, '#7d6eb2'); px(ctx, 16, 23, 2, 2, '#51467a'); }
  if (neck === 'collar') { px(ctx, 9, 22, 16, 2, '#6da3a0'); }

  if (head === 'bow') { px(ctx, 7, 8, 5, 5, '#d9464f'); px(ctx, 13, 9, 3, 3, '#a72e3a'); px(ctx, 16, 8, 5, 5, '#d9464f'); }
  if (head === 'flower') { px(ctx, 8, 8, 3, 3, '#f0a5b5'); px(ctx, 11, 6, 3, 3, '#f7c2cc'); px(ctx, 13, 9, 3, 3, '#f0a5b5'); px(ctx, 11, 9, 2, 2, '#e2b54a'); }
  if (head === 'leaf') { px(ctx, 14, 5, 3, 7, '#63a85d'); px(ctx, 17, 6, 5, 3, '#84c36b'); }
  if (head === 'cap') { px(ctx, 7, 7, 19, 5, '#c94342'); px(ctx, 11, 4, 12, 5, '#e15c50'); px(ctx, 23, 10, 5, 2, '#8e3134'); }
  if (head === 'crown') { px(ctx, 9, 5, 15, 7, '#e2b642'); px(ctx, 9, 3, 3, 4, '#e2b642'); px(ctx, 15, 2, 3, 5, '#f2d362'); px(ctx, 21, 3, 3, 4, '#e2b642'); }
  if (head === 'sleepcap') { px(ctx, 9, 5, 15, 7, '#7895c8'); px(ctx, 18, 2, 8, 5, '#7895c8'); px(ctx, 25, 1, 3, 3, '#e9eef8'); }
  if (head === 'carrot') { px(ctx, 10, 6, 6, 3, '#ef8a32'); px(ctx, 15, 4, 2, 4, '#63a85d'); px(ctx, 17, 4, 3, 2, '#78bd69'); }

  if (behavior === 'BRUSH' && frame % 2) { px(ctx, 26, 12, 2, 2, '#f4d95d'); px(ctx, 28, 9, 1, 4, '#f4d95d'); }
}

function px(ctx, x, y, w, h, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha, 0, 1);
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}
