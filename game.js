'use strict';

// ==============================
// CONSTANTS
// ==============================
const TILE_SIZE = 32;
const MAP_W = 50;
const MAP_H = 40;
const CANVAS_W = 1280;
const CANVAS_H = 720;
const PLAYER_SPEED = 110;

const T = {
    GRASS: 0, PATH: 1, WALL: 2, TREE: 3, WATER: 4,
    FLOOR: 5, STONE: 6, DARK_GRASS: 7, SPECIAL: 8
};
const BLOCKED = new Set([T.WALL, T.TREE, T.WATER]);

const TILE_COLORS = {
    0: '#3a4a3a', 1: '#5a5a5a', 2: '#2a2a2a', 3: '#1a2a1a',
    4: '#2a3a5a', 5: '#5a4a3a', 6: '#5a5a5a', 7: '#2a3a2a', 8: '#4a4a5a'
};

// ==============================
// GAME STATE
// ==============================
const S = {
    state: 'INTRO',
    canvas: null, ctx: null, pCanvas: null, pCtx: null,
    player: { x: 0, y: 0, dir: 'down', moving: false, step: 0, stepTimer: 0 },
    camera: { x: 0, y: 0 },
    map: [],
    npcs: [],
    shardsCollected: 0,
    hallOpen: false,
    southOpen: false,
    keys: {},
    dialog: null,
    intro: null,
    introIndex: 0,
    ending: null,
    lastTime: 0,
    delta: 0,
    particles: [],
    bgStarted: false,
    debug: true
};

// ==============================
// AUDIO
// ==============================
const Audio = (() => {
    let ctx = null;
    let bgmTimer = null;
    let bgmPlaying = false;

    function init() {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }

    function resume() {
        if (ctx && ctx.state === 'suspended') ctx.resume();
    }

    function note(freq, dur, type, vol, time) {
        if (!ctx) return;
        const t = time !== undefined ? time : ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type || 'square';
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol || 0.08, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + dur);
    }

    function playCollect() {
        if (!ctx) return;
        const t = ctx.currentTime;
        note(523, 0.12, 'square', 0.08, t);
        note(659, 0.12, 'square', 0.08, t + 0.08);
        note(784, 0.25, 'square', 0.1, t + 0.16);
    }

    function playStep() { note(90, 0.04, 'square', 0.03); }

    function playDlg() { note(380, 0.06, 'sine', 0.04); }

    function playTrans() {
        if (!ctx) return;
        for (let i = 0; i < 8; i++)
            setTimeout(() => note(200 + i * 60, 0.08, 'sine', 0.04), i * 40);
    }

    function playFanfare() {
        if (!ctx) return;
        [523, 659, 784, 1047].forEach((f, i) =>
            setTimeout(() => note(f, 0.25, 'square', 0.08), i * 180)
        );
    }

    function startBGM(major) {
        stopBGM();
        if (!ctx) return;
        bgmPlaying = true;
        const notes = major ? [523, 659, 784, 1047] : [220, 261, 311, 220];
        let i = 0;
        function tick() {
            if (!bgmPlaying) return;
            note(notes[i], 0.35, 'square', 0.025);
            i = (i + 1) % notes.length;
            bgmTimer = setTimeout(tick, 420);
        }
        tick();
    }

    function stopBGM() { bgmPlaying = false; if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; } }

    return { init, resume, playCollect, playStep, playDlg, playTrans, playFanfare, startBGM, stopBGM };
})();

// ==============================
// MAP
// ==============================
function generateMap() {
    const m = [];
    for (let y = 0; y < MAP_H; y++) { m[y] = []; for (let x = 0; x < MAP_W; x++) m[y][x] = T.WALL; }

    const R = (x1, y1, x2, y2, t) => {
        for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++)
            if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) m[y][x] = t;
    };
    const P = (x1, y1, x2, y2) => {
        let [x, y] = [x1, y1];
        while (x !== x2 || y !== y2) {
            if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) m[y][x] = T.PATH;
            if (x !== x2) x += x2 > x1 ? 1 : -1;
            if (y !== y2) y += y2 > y1 ? 1 : -1;
        }
        if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) m[y][x] = T.PATH;
    };

    // Border (leave gaps for path connections later)
    R(0, 0, MAP_W - 1, 0, T.WALL);
    R(0, MAP_H - 1, MAP_W - 1, MAP_H - 1, T.WALL);
    R(0, 0, 0, MAP_H - 1, T.WALL);
    R(MAP_W - 1, 0, MAP_W - 1, MAP_H - 1, T.WALL);

    // === 遗忘之森 (top-left) ===
    R(2, 2, 18, 13, T.GRASS);
    R(2, 2, 18, 3, T.TREE);
    R(2, 2, 3, 13, T.TREE);
    // Right fence with gaps at y=8 (回音洞穴 path) and y=12-13 (风之旅碑 path)
    for (let y = 2; y <= 13; y++) {
        if (y !== 8 && y !== 12 && y !== 13) { m[y][17] = T.TREE; m[y][18] = T.TREE; }
    }
    // Bottom fence with gap at x=9 (风之旅碑 path)
    for (let x = 2; x <= 18; x++) {
        if (x !== 9) { m[12][x] = T.TREE; m[13][x] = T.TREE; }
    }
    R(6, 5, 12, 10, T.GRASS);

    // === 回音洞穴 (top-right) ===
    R(30, 2, 48, 13, T.STONE);
    R(30, 2, 48, 3, T.WALL);
    R(30, 2, 31, 13, T.WALL);
    R(47, 2, 48, 13, T.WALL);
    // Bottom wall with gap at x=37 (星空倒影 path)
    for (let x = 30; x <= 48; x++) if (x !== 37) { m[12][x] = T.WALL; m[13][x] = T.WALL; }
    R(33, 5, 45, 10, T.FLOOR);
    m[7][35] = T.WALL; m[7][39] = T.WALL;
    m[9][35] = T.WALL; m[9][39] = T.WALL;

    // === 风之旅碑 (bottom-left) ===
    R(2, 18, 18, 30, T.GRASS);
    // Top fence with gap at x=9 (path from 遗忘之森)
    for (let x = 2; x <= 18; x++) if (x !== 9) { m[18][x] = T.TREE; m[19][x] = T.TREE; }
    R(2, 18, 3, 30, T.TREE);
    // Right fence with gap at y=24 (星空倒影 path)
    for (let y = 18; y <= 30; y++) if (y !== 24) { m[y][17] = T.TREE; m[y][18] = T.TREE; }
    // Bottom fence with gap at x=9 (终点回廊 path)
    for (let x = 2; x <= 18; x++) if (x !== 9) { m[29][x] = T.TREE; m[30][x] = T.TREE; }
    R(6, 21, 14, 26, T.STONE);
    m[23][9] = T.SPECIAL;

    // === 星空倒影 (bottom-right) ===
    R(30, 18, 48, 30, T.DARK_GRASS);
    // Top wall with gap at x=37 (path from 回音洞穴)
    for (let x = 30; x <= 48; x++) if (x !== 37) { m[18][x] = T.WALL; m[19][x] = T.WALL; }
    // Left wall with gap at y=24 (path from 风之旅碑)
    for (let y = 18; y <= 30; y++) if (y !== 24) { m[y][30] = T.WALL; m[y][31] = T.WALL; }
    R(47, 18, 48, 30, T.WALL);
    // Bottom wall with gap at x=37 (终点回廊 path)
    for (let x = 30; x <= 48; x++) if (x !== 37) { m[29][x] = T.WALL; m[30][x] = T.WALL; }
    R(33, 21, 45, 27, T.STONE);

    // === 终点回廊 (bottom center) ===
    R(10, 32, 30, 38, T.FLOOR);
    R(10, 32, 30, 32, T.WALL);
    R(10, 32, 10, 38, T.WALL);
    // Right wall with gap at y=34 (生日殿堂 path)
    for (let y = 32; y <= 38; y++) if (y !== 34) { m[y][30] = T.WALL; }
    R(10, 37, 30, 38, T.WALL);
    for (let x = 14; x <= 26; x += 4) { m[33][x] = T.WALL; m[36][x] = T.WALL; }
    // NPC 5 area
    m[34][27] = T.FLOOR; m[34][28] = T.FLOOR; m[34][29] = T.FLOOR;

    // === 生日殿堂 (far right, locked until all shards collected) ===
    R(41, 30, 49, 38, T.SPECIAL);
    R(41, 30, 49, 31, T.WALL);
    R(41, 30, 42, 38, T.WALL);
    R(48, 30, 49, 38, T.WALL);
    R(41, 37, 49, 38, T.WALL);
    // Entrance openings
    m[33][42] = T.FLOOR; m[34][42] = T.FLOOR; m[35][42] = T.FLOOR;
    R(43, 32, 47, 36, T.FLOOR);
    m[33][45] = T.SPECIAL;

    // === CONNECTING PATHS ===
    // Each path starts INSIDE one region and ends INSIDE the adjacent region,
    // punching through walls/fences to create natural openings.

    // 遗忘之森 ↔ 回音洞穴 (horizontal at y=8)
    P(14, 8, 33, 8);

    // 遗忘之森 ↔ 风之旅碑 (vertical at x=9)
    P(9, 11, 9, 21);

    // 回音洞穴 ↔ 星空倒影 (vertical at x=37)
    P(37, 11, 37, 20);

    // 风之旅碑 ↔ 星空倒影 (horizontal at y=24)
    P(16, 24, 31, 24);

    // 风之旅碑 → 终点回廊
    P(9, 28, 9, 31);
    P(9, 31, 20, 31);
    P(20, 31, 20, 33);

    // 星空倒影 → 终点回廊
    P(37, 28, 37, 31);
    P(37, 31, 20, 31);

    // 终点回廊 → 生日殿堂
    P(29, 34, 42, 34);

    // Block hall entrance (removed when all 5 shards collected)
    m[34][40] = T.WALL; m[34][41] = T.WALL;

    // Block south path to 终点回廊 (removed when >= 1 shard collected)
    m[29][9] = T.WALL; m[30][9] = T.WALL;
    m[29][37] = T.WALL; m[30][37] = T.WALL;

    return m;
}

// ==============================
// NPC DATA
// ==============================
const NPC_DATA = [
    {
        id: 0, x: 9, y: 7, name: '???',
        color: '#6aaa6a', hatColor: '#8a4a3a',
        firstDialog: [
            '你终于醒了...我们一直在等你。',
            '这里很久没有人来过了。',
            '今天...你一点特别的感觉都没有吗？',
            '拿着这个——「旋律碎片」。',
            '它或许能帮你想起什么。'
        ],
        progressDialog: [
            '你还在探索呢...加油。',
            '这附近好像还有什么在等着你。'
        ],
        afterDialog: [
            '继续找吧...其他的碎片也在等你。'
        ],
        shardName: '🎵 旋律碎片'
    },
    {
        id: 1, x: 37, y: 7, name: '???',
        color: '#6a8aaa', hatColor: '#3a5a7a',
        firstDialog: [
            '嘘...你听到了吗？',
            '那段旋律...很耳熟吧？',
            '孤独？还是摇滚？',
            '每个人听到的感觉都不一样。',
            '这是「音律碎片」——带着它继续走吧。'
        ],
        progressDialog: [
            '你已经收集了一些碎片了吧？',
            '继续往深处走...答案就在前方。'
        ],
        afterDialog: [
            '记忆在一点点回来，对吧？'
        ],
        shardName: '🎶 音律碎片'
    },
    {
        id: 2, x: 9, y: 24, name: '???',
        color: '#8a8a6a', hatColor: '#5a6a3a',
        firstDialog: [
            '风在低语...你听到了吗？',
            '它在说，有人在等你。',
            '有人在为你准备着什么。',
            '虽然我看不清你的脸，但我能感觉到——',
            '今天对你来说很特别。',
            '拿着「风翼碎片」，继续前进吧。'
        ],
        progressDialog: [
            '你越来越接近了...',
            '风在指引你向前。'
        ],
        afterDialog: [
            '风吹来的方向...就是答案所在。'
        ],
        shardName: '🍃 风翼碎片'
    },
    {
        id: 3, x: 37, y: 24, name: '???',
        color: '#7a7aaa', hatColor: '#3a3a6a',
        firstDialog: [
            '你看那些星星——',
            '它们连成了一条线。',
            '像列车一样，驶向无限的远方。',
            '也像是某种指引...',
            '你离真相越来越近了。',
            '这是「星轨碎片」，收好它。'
        ],
        progressDialog: [
            '星辰在为你闪耀...',
            '你一定能找到最后的答案。'
        ],
        afterDialog: [
            '星辰在指引你...继续走吧。'
        ],
        shardName: '✨ 星轨碎片'
    },
    {
        id: 4, x: 25, y: 34, name: '???',
        color: '#9a6a8a', hatColor: '#5a3a5a',
        firstDialog: [
            '你终于走到这里了。',
            '一直在寻找，一直在跑...',
            '你知道是为什么吗？',
            '其实你心里一直有答案。',
            '今天——是你的生日啊。',
            '大家都在等着给你惊喜呢。',
            '这是最后一片「时光碎片」。',
            '去吧，他们在终点等你。'
        ],
        progressDialog: [
            '嗯？你还没找到其他碎片吗？',
            '先去寻找散落在这个世界的记忆碎片吧...',
            '等收集够了再回来找我。'
        ],
        earlyDialog: [
            '你来得早了一些...',
            '先去探索这个世界，寻找其他的碎片吧。',
            '它们会指引你找到最后的答案。'
        ],
        afterDialog: [
            '路已经打开了...去终点吧。'
        ],
        shardName: '⏳ 时光碎片'
    }
];

// ==============================
// INTRO - Cinematic Opening (4 phases)
// ==============================
const INTRO_PH = { BLACK: 0, TITLE: 1, NARRATIVE: 2, PROMPT: 3 };

const NARRATIVE_LINES = [
    '6月3日。',
    '你睁开了眼睛。',
    '周围的一切...',
    '都失去了颜色。'
];

let introPhase = INTRO_PH.BLACK;
let introTimer = 0;
let introParts = [];
let narIdx = 0, narChar = 0, narPause = 0, narDone = [];
let promptBlink = 0;

function createIntroParticles(count, vyMin, vyMax, alphaMin, alphaMax) {
    for (let i = 0; i < count; i++) {
        introParts.push({
            x: Math.random() * CANVAS_W,
            y: CANVAS_H + Math.random() * 150,
            vx: (Math.random() - 0.5) * 20,
            vy: -vyMin - Math.random() * (vyMax - vyMin),
            size: 1 + Math.random() * 2,
            alpha: alphaMin + Math.random() * (alphaMax - alphaMin),
            speed: 0.5 + Math.random() * 0.5
        });
    }
}

function startIntro() {
    S.state = 'INTRO';
    document.getElementById('hud').classList.add('hidden');
    introPhase = INTRO_PH.BLACK;
    introTimer = 0; narIdx = 0; narChar = 0; narPause = 0; narDone = [];
    introParts = []; promptBlink = 0;
    createIntroParticles(50, 15, 30, 0.15, 0.4);
}

function updateIntro(dt) {
    introTimer += dt;
    switch (introPhase) {
        case INTRO_PH.BLACK:
            if (introTimer >= 2.0) { introPhase = INTRO_PH.TITLE; introTimer = 0; }
            break;
        case INTRO_PH.TITLE:
            for (const p of introParts) {
                p.x += p.vx * dt; p.y += p.vy * dt * p.speed;
                p.alpha -= 0.3 * dt;
                if (p.alpha <= 0) {
                    p.x = Math.random() * CANVAS_W; p.y = CANVAS_H + 10;
                    p.vy = -15 - Math.random() * 25; p.alpha = 0.15 + Math.random() * 0.25;
                }
            }
            if (introTimer >= 3.0) {
                introPhase = INTRO_PH.NARRATIVE; introTimer = 0;
                introParts.forEach(p => { p.alpha = 0.08; p.vy = -5 - Math.random() * 8; });
            }
            break;
        case INTRO_PH.NARRATIVE:
            for (const p of introParts) {
                p.x += p.vx * dt * 0.3; p.y += p.vy * dt * 0.3;
                p.alpha = Math.max(0.03, p.alpha - 0.06 * dt);
                if (Math.random() < 0.005) p.alpha = 0.06 + Math.random() * 0.12;
            }
            if (narIdx < NARRATIVE_LINES.length) {
                const line = NARRATIVE_LINES[narIdx];
                if (narChar < line.length) { narChar += 20 * dt; if (narChar > line.length) narChar = line.length; }
                else { narPause += dt; if (narPause >= 1.0) { narDone.push(line); narIdx++; narChar = 0; narPause = 0; } }
            } else { narPause += dt; if (narPause >= 1.5) { introPhase = INTRO_PH.PROMPT; introTimer = 0; } }
            break;
        case INTRO_PH.PROMPT:
            promptBlink += dt;
            break;
    }
}

function renderIntro(ctx) {
    const w = CANVAS_W, h = CANVAS_H;
    switch (introPhase) {
        case INTRO_PH.BLACK:
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
            break;

        case INTRO_PH.TITLE: {
            const g = ctx.createRadialGradient(w/2, h/2, 50, w/2, h/2, w*0.7);
            g.addColorStop(0, '#1a0a2e'); g.addColorStop(0.5, '#0a0a1a'); g.addColorStop(1, '#000');
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            for (const p of introParts) { ctx.fillStyle = `rgba(180,180,240,${p.alpha})`; ctx.fillRect(p.x, p.y, p.size, p.size); }
            let a = 1;
            if (introTimer < 0.5) a = introTimer / 0.5;
            if (introTimer > 2.5) a = Math.max(0, (3 - introTimer) / 0.5);
            ctx.save(); ctx.globalAlpha = a;
            ctx.shadowColor = 'rgba(150,150,255,0.3)'; ctx.shadowBlur = 20;
            ctx.fillStyle = '#ccd'; ctx.font = '52px "ZCOOL QingKe HuangYou", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('《不存在的一天》', w/2, h/2 - 20);
            ctx.font = '24px "ZCOOL QingKe HuangYou", sans-serif'; ctx.fillStyle = '#889'; ctx.shadowBlur = 10;
            ctx.fillText('—— 张进的冒险', w/2, h/2 + 50);
            ctx.restore();
            break;
        }

        case INTRO_PH.NARRATIVE: {
            const g = ctx.createRadialGradient(w/2, h/2, 100, w/2, h/2, w*0.6);
            g.addColorStop(0, '#0a0a1a'); g.addColorStop(1, '#000');
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            for (const p of introParts) { if (p.alpha > 0.04) { ctx.fillStyle = `rgba(100,100,150,${p.alpha*0.3})`; ctx.fillRect(p.x, p.y, p.size, p.size); } }
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '32px "ZCOOL QingKe HuangYou", sans-serif';
            const sy = h/2 - 60;
            for (let i = 0; i < narDone.length; i++) { ctx.fillStyle = '#aaa'; ctx.fillText(narDone[i], w/2, sy + i*48); }
            if (narIdx < NARRATIVE_LINES.length) {
                const txt = NARRATIVE_LINES[narIdx].substring(0, Math.floor(narChar));
                ctx.fillStyle = '#ddd'; ctx.fillText(txt, w/2, sy + narDone.length*48);
                if (Math.floor(introTimer*4)%2===0 && narChar < NARRATIVE_LINES[narIdx].length) {
                    const cx = w/2 + ctx.measureText(txt).width/2 + 4;
                    ctx.fillRect(cx, sy + narDone.length*48 - 14, 3, 28);
                }
            }
            break;
        }

        case INTRO_PH.PROMPT: {
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
            for (const p of introParts) { if (p.alpha > 0.04) { ctx.fillStyle = `rgba(100,100,150,${p.alpha*0.2})`; ctx.fillRect(p.x, p.y, p.size, p.size); } }
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '32px "ZCOOL QingKe HuangYou", sans-serif';
            const sy = h/2 - 130; ctx.fillStyle = '#666';
            for (let i = 0; i < NARRATIVE_LINES.length; i++) ctx.fillText(NARRATIVE_LINES[i], w/2, sy + i*48);
            if (Math.floor(introTimer*2)%2===0) {
                ctx.fillStyle = '#aaa'; ctx.font = '28px "ZCOOL QingKe HuangYou", sans-serif';
                ctx.fillText('按 空格 开始探索', w/2, h/2 + 100);
            }
            break;
        }
    }
}

// ==============================
// PLAYER SPRITE RENDER
// ==============================
function drawPlayer() {
    const ctx = S.ctx;
    const px = S.player.x - S.camera.x;
    const py = S.player.y - S.camera.y;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px - 8, py + 12, 16, 4);

    const bob = S.player.moving ? Math.sin(S.player.step * 6) * 1.5 : 0;

    // === Body ===
    // Torso
    ctx.fillStyle = '#4a7fb5';
    ctx.fillRect(px - 8, py - 5 + bob, 16, 12);
    // Collar
    ctx.fillStyle = '#3a6a9a';
    ctx.fillRect(px - 7, py - 5 + bob, 14, 3);
    // Belt
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(px - 7, py + 5 + bob, 14, 2);

    // === Head ===
    ctx.fillStyle = '#f0c8a0';
    ctx.fillRect(px - 7, py - 16 + bob, 14, 12);

    // Hair
    ctx.fillStyle = '#4a3728';
    ctx.fillRect(px - 8, py - 18 + bob, 16, 5);
    // Hair bangs
    if (S.player.step % 2 === 0) {
        ctx.fillRect(px - 7, py - 18 + bob, 5, 3);
        ctx.fillRect(px + 2, py - 18 + bob, 4, 2);
    } else {
        ctx.fillRect(px - 6, py - 18 + bob, 4, 2);
        ctx.fillRect(px + 1, py - 18 + bob, 5, 3);
    }

    // Eyes
    ctx.fillStyle = '#222';
    if (S.player.dir === 'right') {
        ctx.fillRect(px + 2, py - 13 + bob, 2, 2);
        ctx.fillRect(px + 5, py - 13 + bob, 2, 2);
    } else if (S.player.dir === 'left') {
        ctx.fillRect(px - 5, py - 13 + bob, 2, 2);
        ctx.fillRect(px - 2, py - 13 + bob, 2, 2);
    } else {
        ctx.fillRect(px - 4, py - 13 + bob, 2, 2);
        ctx.fillRect(px + 2, py - 13 + bob, 2, 2);
    }

    // Mouth
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(px - 1, py - 9 + bob, 2, 1);

    // === Arms ===
    const armSwing = S.player.moving ? Math.sin(S.player.step * 6) * 2 : 0;
    ctx.fillStyle = '#f0c8a0';
    ctx.fillRect(px - 10, py - 4 + armSwing + bob, 3, 9);
    ctx.fillRect(px + 7, py - 4 - armSwing + bob, 3, 9);
    // Hands
    ctx.fillStyle = '#e8b890';
    ctx.fillRect(px - 10, py + 5 + armSwing + bob, 3, 2);
    ctx.fillRect(px + 7, py + 5 - armSwing + bob, 3, 2);

    // === Legs ===
    ctx.fillStyle = '#3d5a3d';
    const legOff = S.player.moving ? Math.sin(S.player.step * 6) * 2.5 : 0;
    ctx.fillRect(px - 5, py + 7 + legOff + bob, 5, 7);
    ctx.fillRect(px + 1, py + 7 - legOff + bob, 5, 7);

    // Shoes
    ctx.fillStyle = '#4a2a1a';
    ctx.fillRect(px - 6, py + 14 + legOff + bob, 6, 3);
    ctx.fillRect(px + 1, py + 14 - legOff + bob, 6, 3);
}

// ==============================
// NPC RENDER
// ==============================
function drawNPC(npc) {
    const ctx = S.ctx;
    const px = npc.x * TILE_SIZE + 16 - S.camera.x;
    const py = npc.y * TILE_SIZE + 20 - S.camera.y;

    if (px < -40 || px > CANVAS_W + 40 || py < -40 || py > CANVAS_H + 40) return;

    const given = S.shardsCollected >= 5;
    const bodyColor = given ? npc.hatColor : npc.color;
    const skinColor = given ? '#f0c8a0' : '#6a5a4a';
    const hatVis = given;

    // Glow ring at feet
    ctx.fillStyle = 'rgba(255,255,200,0.08)';
    ctx.beginPath(); ctx.arc(px, py + 12, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,200,0.04)';
    ctx.beginPath(); ctx.arc(px, py + 12, 26, 0, Math.PI * 2); ctx.fill();

    // Outline
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px - 8, py - 17, 16, 29);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px - 8, py + 10, 16, 4);

    // Body (slightly wider)
    ctx.fillStyle = bodyColor;
    ctx.fillRect(px - 7, py - 6, 14, 12);

    // Head
    ctx.fillStyle = skinColor;
    ctx.fillRect(px - 6, py - 16, 12, 11);

    // Eyes
    ctx.fillStyle = given ? '#222' : '#888';
    ctx.fillRect(px - 3, py - 13, 2, 2);
    ctx.fillRect(px + 1, py - 13, 2, 2);

    // Party hat if collected all
    if (hatVis) {
        ctx.fillStyle = npc.hatColor;
        ctx.beginPath();
        ctx.moveTo(px, py - 22);
        ctx.lineTo(px + 8, py - 28);
        ctx.lineTo(px + 16, py - 22);
        ctx.fill();
        ctx.fillStyle = '#ff0';
        ctx.beginPath();
        ctx.arc(px + 8, py - 29, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ==============================
// TILE RENDERING
// ==============================
function drawTile(x, y, type) {
    const ctx = S.ctx;
    const sx = x * TILE_SIZE - S.camera.x;
    const sy = y * TILE_SIZE - S.camera.y;

    if (sx < -TILE_SIZE || sx > CANVAS_W || sy < -TILE_SIZE || sy > CANVAS_H) return;

    let base = TILE_COLORS[type] || '#3a4a3a';

    switch (type) {
        case T.GRASS:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#2a3a2a';
            if ((x * 7 + y * 13) % 5 === 0) ctx.fillRect(sx + 8, sy + 16, 2, 2);
            if ((x * 11 + y * 3) % 7 === 0) ctx.fillRect(sx + 20, sy + 8, 2, 2);
            if ((x * 5 + y * 17) % 11 === 0) ctx.fillRect(sx + 12, sy + 24, 2, 2);
            break;
        case T.PATH:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(sx + 2, sy + 2, 4, 4);
            ctx.fillRect(sx + 16, sy + 14, 4, 4);
            break;
        case T.WALL:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#3a3a3a';
            ctx.fillRect(sx, sy + 15, TILE_SIZE, 2);
            ctx.fillRect(sx + 15, sy, 2, TILE_SIZE);
            ctx.fillStyle = '#222';
            ctx.fillRect(sx + 4, sy + 4, 4, 4); ctx.fillRect(sx + 20, sy + 20, 4, 4);
            break;
        case T.TREE:
            ctx.fillStyle = '#3a4a3a'; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#3a2a1a'; ctx.fillRect(sx + 13, sy + 12, 6, 16);
            ctx.fillStyle = '#1a2a1a';
            ctx.beginPath(); ctx.arc(sx + 16, sy + 10, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#0a1a0a';
            ctx.beginPath(); ctx.arc(sx + 12, sy + 8, 6, 0, Math.PI * 2); ctx.fill();
            break;
        case T.WATER:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#3a4a6a';
            ctx.fillRect(sx + 4, sy + 8, 8, 2);
            ctx.fillRect(sx + 16, sy + 20, 12, 2);
            break;
        case T.FLOOR:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#4a3a2a';
            if ((x + y) % 2 === 0) ctx.fillRect(sx + 2, sy + 2, 12, 12);
            else ctx.fillRect(sx + 16, sy + 16, 12, 12);
            break;
        case T.STONE:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(sx + 1, sy + 1, 14, 14);
            break;
        case T.DARK_GRASS:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#1a2a1a';
            if ((x * 3 + y * 7) % 5 === 0) ctx.fillRect(sx + 6, sy + 6, 3, 3);
            break;
        case T.SPECIAL:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#5a5a6a';
            ctx.fillRect(sx + 4, sy + 4, 24, 24);
            ctx.fillStyle = '#6a6a7a';
            ctx.fillRect(sx + 8, sy + 8, 16, 16);
            break;
        default:
            ctx.fillStyle = base; ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    }
}

// ==============================
// COLLISION
// ==============================
function isBlocked(x, y) {
    const hw = 7, hh = 9;
    const l = Math.floor((x - hw) / TILE_SIZE);
    const r = Math.floor((x + hw) / TILE_SIZE);
    const t = Math.floor((y - hh) / TILE_SIZE);
    const b = Math.floor((y + hh) / TILE_SIZE);
    for (let ty = t; ty <= b; ty++) {
        for (let tx = l; tx <= r; tx++) {
            if (ty < 0 || ty >= MAP_H || tx < 0 || tx >= MAP_W) return true;
            if (BLOCKED.has(S.map[ty][tx])) return true;
        }
    }
    return false;
}

// ==============================
// INPUT
// ==============================
document.addEventListener('keydown', e => {
    S.keys[e.code] = true;
    Audio.resume();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Enter'].includes(e.code)) {
        e.preventDefault();
    }

    if (S.state === 'INTRO') {
        if ((e.code === 'Space' || e.code === 'Enter') && introPhase === INTRO_PH.PROMPT) {
            document.getElementById('hud').classList.remove('hidden');
            S.state = 'PLAYING';
            Audio.startBGM(false);
        }
    } else if (S.state === 'DIALOG') {
        if (e.code === 'Space' || e.code === 'Enter') {
            advanceDialog();
        }
    }
});

document.addEventListener('keyup', e => { S.keys[e.code] = false; });

// (intro system above - no old variables/functions here)

// ==============================
// DIALOG
// ==============================
let dialogNpc = null;
let dialogLines = [];
let dialogLineIdx = 0;
let dialogCurrentText = '';
let dialogCharIdx = 0;
let dialogTyping = false;
let dialogTimer = null;
let dialogCallback = null;

function startDialog(npc, lines, callback) {
    S.state = 'DIALOG';
    dialogNpc = npc;
    dialogLines = lines;
    dialogLineIdx = 0;
    dialogCallback = callback || null;
    Audio.playDlg();
    document.getElementById('dialog-box').classList.remove('hidden');
    document.getElementById('dialog-speaker-name').textContent = npc.name;
    showDialogLine();
}

function showDialogLine() {
    if (dialogLineIdx >= dialogLines.length) {
        closeDialog();
        return;
    }
    const line = dialogLines[dialogLineIdx];
    dialogCurrentText = '';
    dialogCharIdx = 0;
    dialogTyping = true;
    document.getElementById('dialog-next-hint').style.display = 'none';
    document.getElementById('dialog-text-area').textContent = '';

    if (dialogTimer) clearInterval(dialogTimer);
    dialogTimer = setInterval(() => {
        if (dialogCharIdx < line.length) {
            dialogCurrentText += line[dialogCharIdx];
            document.getElementById('dialog-text-area').textContent = dialogCurrentText;
            dialogCharIdx++;
            if (dialogCharIdx % 3 === 0) Audio.playDlg();
        } else {
            clearInterval(dialogTimer);
            dialogTimer = null;
            dialogTyping = false;
            document.getElementById('dialog-next-hint').style.display = 'block';
        }
    }, 30);
}

function advanceDialog() {
    if (dialogTyping) {
        if (dialogTimer) clearInterval(dialogTimer);
        dialogTimer = null;
        dialogCurrentText = dialogLines[dialogLineIdx];
        document.getElementById('dialog-text-area').textContent = dialogCurrentText;
        dialogCharIdx = dialogCurrentText.length;
        dialogTyping = false;
        document.getElementById('dialog-next-hint').style.display = 'block';
        return;
    }
    dialogLineIdx++;
    if (dialogLineIdx >= dialogLines.length) {
        closeDialog();
    } else {
        showDialogLine();
    }
}

function closeDialog() {
    if (dialogTimer) clearInterval(dialogTimer);
    dialogTimer = null;
    document.getElementById('dialog-box').classList.add('hidden');
    S.state = 'PLAYING';
    // Clear space/enter keys to avoid immediate re-trigger
    S.keys['Space'] = false;
    S.keys['Enter'] = false;
    if (dialogCallback) {
        const cb = dialogCallback;
        dialogCallback = null;
        cb();
    }
}

// ==============================
// PLAYER UPDATE
// ==============================
function updatePlayer(dt) {
    if (S.state !== 'PLAYING') { S.player.moving = false; return; }

    let dx = 0, dy = 0;
    if (S.keys['ArrowLeft'] || S.keys['KeyA']) dx = -1;
    if (S.keys['ArrowRight'] || S.keys['KeyD']) dx = 1;
    if (S.keys['ArrowUp'] || S.keys['KeyW']) dy = -1;
    if (S.keys['ArrowDown'] || S.keys['KeyS']) dy = 1;

    S.player.moving = (dx !== 0 || dy !== 0);

    if (dx !== 0 && dy !== 0) {
        const len = Math.sqrt(2);
        dx /= len; dy /= len;
    }

    if (dx < 0) S.player.dir = 'left';
    else if (dx > 0) S.player.dir = 'right';
    else if (dy < 0) S.player.dir = 'up';
    else if (dy > 0) S.player.dir = 'down';

    if (S.player.moving) {
        S.player.stepTimer += dt;
        if (S.player.stepTimer > 0.15) {
            S.player.step++;
            S.player.stepTimer = 0;
            Audio.playStep();
        }
    } else {
        S.player.stepTimer = 0;
    }

    const speed = PLAYER_SPEED;
    let nx = S.player.x + dx * speed * dt;
    let ny = S.player.y + dy * speed * dt;

    if (!isBlocked(nx, S.player.y)) S.player.x = nx;
    if (!isBlocked(S.player.x, ny)) S.player.y = ny;

    // Interact
    if (S.keys['Space'] || S.keys['Enter']) {
        S.keys['Space'] = false;
        S.keys['Enter'] = false;
        tryInteract();
    }
}

// ==============================
// INTERACTION
// ==============================
function tryInteract() {
    if (S.state !== 'PLAYING') return;
    const px = S.player.x, py = S.player.y;
    for (const npc of S.npcs) {
        const nx = npc.x * TILE_SIZE + 16;
        const ny = npc.y * TILE_SIZE + 16;
        const dist = Math.sqrt((px - nx) ** 2 + (py - ny) ** 2);
        if (dist < 44) {
            interactNpc(npc);
            return;
        }
    }
}

function interactNpc(npc) {
    // Determine dialog based on shard progress
    let lines;
    if (npc.given) {
        lines = npc.afterDialog;
    } else if (S.shardsCollected >= 4 && npc.id === 4) {
        // NPC 4 - final shard only when 4 already collected
        lines = npc.firstDialog;
    } else if (npc.id === 4) {
        // NPC 4 early - send them back
        lines = npc.earlyDialog;
    } else if (S.shardsCollected >= 1) {
        // Player has some shards but hasn't talked to this NPC yet
        lines = npc.progressDialog;
    } else {
        lines = npc.firstDialog;
    }

    const giveShard = !npc.given && (npc.id !== 4 || S.shardsCollected >= 4);

    startDialog(npc, lines, () => {
        if (giveShard) {
            npc.given = true;
            S.shardsCollected++;
            updateShardHUD();
            Audio.playCollect();
            showFloatingText('✨ 获得 ' + npc.shardName + ' ✨', 1500);
            if (S.shardsCollected >= 5) {
                setTimeout(() => {
                    openBirthdayHall();
                }, 1000);
            }
        }
    });
}

let floatingTexts = [];

function showFloatingText(text, duration) {
    floatingTexts.push({
        text, duration, timer: duration,
        x: S.player.x - S.camera.x,
        y: S.player.y - S.camera.y - 30
    });
}

function updateFloatingTexts(dt) {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        floatingTexts[i].timer -= dt * 1000;
        floatingTexts[i].y -= 20 * dt;
        if (floatingTexts[i].timer <= 0) floatingTexts.splice(i, 1);
    }
}

function drawNpcInteractionHint() {
    const ctx = S.ctx;
    const px = S.player.x, py = S.player.y;
    for (const npc of S.npcs) {
        const nx = npc.x * TILE_SIZE + 16;
        const ny = npc.y * TILE_SIZE + 16;
        const dist = Math.sqrt((px - nx) ** 2 + (py - ny) ** 2);
        if (dist < 44) {
            const sx = nx - S.camera.x;
            const sy = ny - S.camera.y - 32;
            if (sx < -20 || sx > CANVAS_W + 20 || sy < -20 || sy > CANVAS_H + 20) break;
            const pulse = 0.5 + 0.5 * Math.sin(S.lastTime * 4);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.fillStyle = '#fff';
            ctx.font = '16px "ZCOOL QingKe HuangYou", sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'rgba(255,255,255,0.5)';
            ctx.shadowBlur = 8;
            ctx.fillText('[ 按 空格 对话 ]', sx, sy);
            ctx.restore();
            break;
        }
    }
}

function drawGuidanceHint() {
    if (S.shardsCollected > 0) return;
    const ctx = S.ctx;
    // Find the nearest NPC that hasn't been talked to
    const px = S.player.x, py = S.player.y;
    let bestDist = Infinity, bestNpc = null;
    for (const npc of S.npcs) {
        if (npc.given) continue;
        const nx = npc.x * TILE_SIZE + 16;
        const ny = npc.y * TILE_SIZE + 16;
        const dist = Math.sqrt((px - nx) ** 2 + (py - ny) ** 2);
        if (dist < bestDist) { bestDist = dist; bestNpc = npc; }
    }
    if (!bestNpc) return;
    const nx = bestNpc.x * TILE_SIZE + 16 - S.camera.x;
    const ny = bestNpc.y * TILE_SIZE + 16 - S.camera.y;
    const pulse = 0.3 + 0.2 * Math.sin(S.lastTime * 2);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffdd88';
    ctx.font = '14px "ZCOOL QingKe HuangYou", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦ 附近有神秘人...', nx, ny - 46);
    ctx.restore();
}

function drawFloatingTexts() {
    const ctx = S.ctx;
    for (const ft of floatingTexts) {
        const alpha = Math.min(1, ft.timer / 300);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffd700';
        ctx.font = '22px "ZCOOL QingKe HuangYou", sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
    }
}

function updateShardHUD() {
    document.getElementById('shard-count').textContent =
        '🌟 记忆碎片: ' + S.shardsCollected + ' / 5';
}

function openBirthdayHall() {
    Audio.playTrans();
    // Remove the wall blocking the hall
    S.map[34][40] = T.PATH;
    S.map[34][41] = T.PATH;
    S.hallOpen = true;
    document.getElementById('all-collected-msg').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('all-collected-msg').classList.add('hidden');
    }, 5000);
}

// ==============================
// CAMERA
// ==============================
function updateCamera() {
    const tx = S.player.x - CANVAS_W / 2;
    const ty = S.player.y - CANVAS_H / 2;
    S.camera.x += (tx - S.camera.x) * 0.1;
    S.camera.y += (ty - S.camera.y) * 0.1;
    const maxX = MAP_W * TILE_SIZE - CANVAS_W;
    const maxY = MAP_H * TILE_SIZE - CANVAS_H;
    S.camera.x = Math.max(0, Math.min(maxX, S.camera.x));
    S.camera.y = Math.max(0, Math.min(maxY, S.camera.y));
}

// ==============================
// ENDING
// ==============================
const ENDING = {
    particles: [],
    timer: 0,
    stars: [],
    phase: 0 // 0=fade in, 1=show text, 2=party
};

function makeConfetti() {
    const colors = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0', '#ff8800', '#ff4488', '#88ff44'];
    for (let i = 0; i < 80; i++) {
        ENDING.particles.push({
            x: Math.random() * CANVAS_W,
            y: -30 - Math.random() * 200,
            vx: (Math.random() - 0.5) * 120,
            vy: 80 + Math.random() * 120,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 4 + Math.random() * 6,
            rot: Math.random() * 6,
            rotSpeed: (Math.random() - 0.5) * 4,
            life: 1
        });
    }
}

function makeStars() {
    for (let i = 0; i < 60; i++) {
        ENDING.stars.push({
            x: Math.random() * CANVAS_W,
            y: Math.random() * CANVAS_H * 0.6,
            size: 1 + Math.random() * 2.5,
            twinkle: Math.random() * 100,
            speed: 0.5 + Math.random() * 1.5
        });
    }
}

function startEnding() {
    S.state = 'ENDING';
    Audio.stopBGM();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('all-collected-msg').classList.add('hidden');
    ENDING.particles = [];
    ENDING.stars = [];
    ENDING.timer = 0;
    ENDING.phase = 0;

    // Setup particle canvas
    S.pCanvas = document.getElementById('particleCanvas');
    S.pCtx = S.pCanvas.getContext('2d');
    S.pCanvas.width = CANVAS_W;
    S.pCanvas.height = CANVAS_H;
    S.pCtx.imageSmoothingEnabled = false;

    makeStars();

    // Show ending overlay
    document.getElementById('ending-overlay').classList.remove('hidden');

    // Fill birthday message
    document.getElementById('birthday-message').innerHTML =
        '破案了朋友们！！！<br><br>' +
        '什么悬疑像素风、什么神秘世界——<br>' +
        '全都是为了给你整这出生日惊喜！<br><br>' +
        '🎮 祝你新的一岁：<br>' +
        '&nbsp;&nbsp;崩铁十连三金不歪<br>' +
        '&nbsp;&nbsp;街霸上分全是神人<br>' +
        '&nbsp;&nbsp;旮旯给木哈皮安定<br>' +
        '&nbsp;&nbsp;骑行永远不掉链子<br><br>' +
        '—— Bro 敬上 💪';

    setTimeout(() => {
        Audio.playFanfare();
        Audio.startBGM(true);
        makeConfetti();
        ENDING.phase = 1;
    }, 500);
}

function updateEnding(dt) {
    ENDING.timer += dt;

    // Update stars
    for (const s of ENDING.stars) {
        s.twinkle += dt * 100 * s.speed;
    }

    // Update confetti
    for (let i = ENDING.particles.length - 1; i >= 0; i--) {
        const p = ENDING.particles[i];
        p.x += p.vx * dt;
        p.vy += 150 * dt; // gravity
        p.y += p.vy * dt;
        p.rot += p.rotSpeed * dt;
        p.vx += (Math.random() - 0.5) * 20 * dt;
        if (p.y > CANVAS_H + 40) {
            p.y = -20;
            p.vy = 50 + Math.random() * 80;
            p.x = Math.random() * CANVAS_W;
        }
    }
}

function renderEnding() {
    const ctx = S.pCtx;
    if (!ctx) return;

    // Clear with gradient
    const grad = ctx.createRadialGradient(640, 360, 80, 640, 360, 720);
    grad.addColorStop(0, '#2a0044');
    grad.addColorStop(0.5, '#1a0033');
    grad.addColorStop(1, '#0a0a1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw stars
    for (const s of ENDING.stars) {
        const alpha = 0.3 + 0.7 * Math.abs(Math.sin(s.twinkle * 0.05));
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    // Draw confetti
    for (const p of ENDING.particles) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
    }

    // Draw some sparkles
    const t = ENDING.timer;
    for (let i = 0; i < 10; i++) {
        const sx = 100 + Math.sin(t * 1.5 + i * 1.2) * 300 + 400;
        const sy = 100 + Math.cos(t * 1.3 + i * 0.8) * 150 + 150;
        const ss = 2 + Math.sin(t * 2 + i) * 1.5;
        ctx.fillStyle = `rgba(255,215,0,${0.3 + 0.3 * Math.sin(t * 2 + i)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, ss, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ==============================
// MAIN RENDER
// ==============================
function render() {
    const ctx = S.ctx;

    if (S.state === 'INTRO') {
        renderIntro(ctx);
        return;
    }

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Debug info
    if (S.debug) {
        ctx.fillStyle = '#fff';
        ctx.font = '14px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`State: ${S.state}`, 10, 20);
        ctx.fillText(`Player: (${Math.floor(S.player.x)}, ${Math.floor(S.player.y)})`, 10, 35);
        ctx.fillText(`Camera: (${Math.floor(S.camera.x)}, ${Math.floor(S.camera.y)})`, 10, 50);
        ctx.fillText(`Map size: ${S.map.length}x${S.map[0]?.length || 0}`, 10, 65);
        ctx.fillText(`NPCs: ${S.npcs.length}`, 10, 80);
    }

    if (S.state === 'PLAYING' || S.state === 'DIALOG') {
        // Draw visible tiles
        const startX = Math.max(0, Math.floor(S.camera.x / TILE_SIZE));
        const endX = Math.min(MAP_W - 1, Math.ceil((S.camera.x + CANVAS_W) / TILE_SIZE));
        const startY = Math.max(0, Math.floor(S.camera.y / TILE_SIZE));
        const endY = Math.min(MAP_H - 1, Math.ceil((S.camera.y + CANVAS_H) / TILE_SIZE));

        for (let y = startY; y <= endY; y++)
            for (let x = startX; x <= endX; x++)
                drawTile(x, y, S.map[y][x]);

        // Draw NPCs
        for (const npc of S.npcs) drawNPC(npc);

        // Draw guidance hint when no shards collected
        drawGuidanceHint();

        // Draw near-NPC interaction hint
        drawNpcInteractionHint();

        // Draw player
        drawPlayer();

        // Draw floating texts
        drawFloatingTexts();

        // Draw hall hint
        if (S.hallOpen) {
            const hx = 44 * TILE_SIZE + 16 - S.camera.x;
            const hy = 34 * TILE_SIZE - 20 - S.camera.y;
            if (hx > 0 && hx < CANVAS_W && hy > 0 && hy < CANVAS_H) {
                const pulse = 0.3 + 0.3 * Math.sin(S.lastTime * 3);
                ctx.fillStyle = `rgba(255,215,0,${pulse})`;
                ctx.font = '18px "ZCOOL QingKe HuangYou", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('★ 生日殿堂 →', hx, hy);
            }
        }

        // Vignette effect
        const grad = ctx.createRadialGradient(640, 360, 300, 640, 360, 720);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.3)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
}

// ==============================
// GAME LOOP
// ==============================
function gameLoop(timestamp) {
    const dt = Math.min(0.05, (timestamp - S.lastTime) / 1000);
    S.lastTime = timestamp;
    S.delta = dt;

    const state = S.state;

    if (state === 'INTRO') {
        updateIntro(dt);
    } else if (state === 'PLAYING' || state === 'DIALOG') {
        // Open south path to 终点回廊 once at least 1 shard collected
        if (!S.southOpen && S.shardsCollected >= 1) {
            S.southOpen = true;
            S.map[29][9] = T.PATH; S.map[30][9] = T.PATH;
            S.map[29][37] = T.PATH; S.map[30][37] = T.PATH;
        }

        updateCamera();
        updatePlayer(dt);
        updateFloatingTexts(dt);

        if (S.hallOpen && state === 'PLAYING') {
            const tx = Math.floor(S.player.x / TILE_SIZE);
            const ty = Math.floor(S.player.y / TILE_SIZE);
            if (tx >= 43 && tx <= 47 && ty >= 33 && ty <= 36) {
                startEnding();
            }
        }
    }

    render();

    if (state === 'ENDING') {
        updateEnding(dt);
        renderEnding();
    }

    requestAnimationFrame(gameLoop);
}

// ==============================
// INIT
// ==============================
function resizeCanvas() {
    const container = document.getElementById('game-container');
    const canvas = S.canvas;
    if (!canvas || !container) return;
    
    // Keep internal resolution fixed at 800x600 for consistent rendering
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    
    // CSS will scale it to fit the container
}

function init() {
    try {
        S.canvas = document.getElementById('gameCanvas');
        if (!S.canvas) return console.error('Canvas not found');
        S.ctx = S.canvas.getContext('2d');
        if (!S.ctx) return console.error('2d context failed');
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        S.ctx.imageSmoothingEnabled = false;

        Audio.init();

        S.map = generateMap();

        S.player.x = 9 * TILE_SIZE + 16;
        S.player.y = 9 * TILE_SIZE + 16;

S.npcs = NPC_DATA.map(d => ({
        id: d.id, x: d.x, y: d.y, name: d.name,
        color: d.color, hatColor: d.hatColor,
        firstDialog: d.firstDialog, afterDialog: d.afterDialog,
        progressDialog: d.progressDialog,
        earlyDialog: d.earlyDialog,
        shardName: d.shardName, given: false
    }));

        // Start intro
        startIntro();
        requestAnimationFrame(gameLoop);
    } catch (e) {
        console.error('Init error:', e);
        document.body.innerHTML = '<pre style="color:red;padding:20px;background:#000">Init error: ' + e.message + ' (line ' + (e.lineNumber || '?') + ')</pre>';
    }
}

window.onload = init;
