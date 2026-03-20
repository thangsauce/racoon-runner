import React, { Component } from 'react';

const W = 600;
const H = 200;
const GROUND_Y = 160;
const GRAVITY = 0.5;
const JUMP_V = -9;
const INITIAL_SPEED = 5.5;

const SPEED_MILESTONES = [500, 1000, 1500, 2000, 2500, 3000]; // score thresholds for speed jumps
const SPEED_AT_MILESTONE = [6.5, 7.5, 8.5, 9.5, 10.5, 11];   // speed after each milestone
const FPS = 60;             // reference frame rate for dt normalisation

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

interface Raccoon {
    x: number;
    y: number;
    vy: number;
    onGround: boolean;
    ducking: boolean;
    legPhase: number;
}

interface Cloud {
    x: number;
    y: number;
    w: number;
}

interface CrackPoint {
    dx: number;
    dy: number;
}

interface Crack {
    x: number;
    y: number;
    pts: CrackPoint[];
}

interface Obstacle {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    speedMult?: number;
    fallen?: boolean;
    fallAngle?: number;
}

interface DeathPixel {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    size: number;
}

interface GameState {
    started: boolean;
    dead: boolean;
    score: number;
    best: number;
    night: boolean;
}


const BODY_SPRITE: number[][] = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,2,2,0,0,0,0,0,0,0,0,2,2,0,0,0,0,2,2,0,0],
    [0,0,0,2,5,5,2,0,0,0,0,0,0,2,4,4,2,0,0,2,4,4,2,0],
    [0,0,0,0,2,2,2,0,0,0,0,0,2,4,4,1,2,2,2,2,1,4,4,2],
    [0,0,0,2,5,5,2,0,0,0,0,2,1,1,5,5,5,5,5,5,1,1,3,0],
    [0,0,0,2,2,2,2,2,0,2,2,1,1,1,5,1,1,1,1,5,1,3,3,0],
    [0,0,0,2,5,5,2,2,0,2,1,1,1,1,4,5,4,4,5,4,3,0,0,0],
    [0,0,0,0,2,2,2,2,2,1,1,1,1,1,4,4,4,4,4,4,2,0,0,0],
    [0,0,0,0,2,2,2,2,1,1,1,1,1,1,3,3,5,5,5,5,4,0,0,0],
    [0,0,0,0,0,2,2,2,2,1,1,1,3,3,5,5,5,3,3,0,0,0,0,0],
    [0,0,0,0,0,2,2,2,2,2,1,3,3,5,5,5,3,3,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,2,2,1,1,1,3,5,5,5,5,0,0,0,0,0,0,0]
];

const LEGS_A: number[][] = [
    [0,0,0,0,0,0,0,0,0,4,4,0,0,4,4,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,4,4,0,0,4,4,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,4,4,4,0,4,4,4,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,2,2,2,0,2,2,2,0,0,0,0,0,0,0,0]
];

const LEGS_B: number[][] = [
    [0,0,0,0,0,0,0,0,4,4,0,0,0,0,4,4,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,4,4,0,0,0,0,4,4,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,4,4,4,0,0,0,4,4,4,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,2,2,2,0,0,0,2,2,2,0,0,0,0,0,0,0]
];

export default class RaccoonGame extends Component<Record<string, never>, GameState> {
    private canvasRef = React.createRef<HTMLCanvasElement>();
    private animId: number | null = null;
    private idleAnimId: number | null = null;
    private lastTime: number | null = null;
    private obstacleTimer = 0;
    private nextObstacleIn = 1400;
    private frameCount = 0;
    private raccoon: Raccoon;
    private obstacles: Obstacle[] = [];
    private clouds: Cloud[] = [
        { x: 100, y: 40, w: 60 },
        { x: 320, y: 28, w: 80 },
        { x: 500, y: 50, w: 50 },
    ];
    private groundOffset = 0;
    private roadDashOffset = 0;
    private cracks: Crack[] = [];
    private crackTimer = 0;
    private nextCrackIn = 2500 + Math.random() * 3000;
    private speed = INITIAL_SPEED;
    private score = 0;
    private nightMode = false;
    private killerObstacle: Obstacle | null = null;
    private lastSpeedTier = -1;
    private speedFlash = 0;
    private deathPixels: DeathPixel[] = [];
    private deathAnimId: number | null = null;
    private deathPixelTime: number | null = null;
    private themeObserver: MutationObserver | null = null;
    private audioCtx: AudioContext | null = null;

    private isDarkMode(): boolean {
        return !document.body.classList.contains('light-style');
    }

    private getRaccoonColors(night: boolean, isDark: boolean): (string | null)[] {
        return [
            null,
            night ? '#b8b8b8' : (isDark ? '#999999' : '#767676'),
            night ? '#686868' : (isDark ? '#484848' : '#3a3a3a'),
            night ? '#d8d8d8' : (isDark ? '#c0c0c0' : '#b8b8b8'),
            '#111111',
            '#eeeeee',
        ];
    }

    private getAudioCtx(): AudioContext {
        if (!this.audioCtx) this.audioCtx = new AudioContext();
        return this.audioCtx;
    }

    private playJumpSound() {
        try {
            const ctx = this.getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch (_) { /* audio not available */ }
    }

    private playSpeedUpSound() {
        try {
            const ctx = this.getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.25);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch (_) { /* audio not available */ }
    }

    private playMotorcycleSound() {
        try {
            const ctx = this.getAudioCtx();
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(80, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(130, ctx.currentTime + 0.3);
            osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 1.5);
            osc.frequency.linearRampToValueAtTime(70, ctx.currentTime + 3.5);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.06, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.14, ctx.currentTime + 2.0);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5);
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(400, ctx.currentTime);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 3.5);
            const osc2 = ctx.createOscillator();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(200, ctx.currentTime);
            osc2.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.5);
            osc2.frequency.linearRampToValueAtTime(350, ctx.currentTime + 2.0);
            osc2.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 3.5);
            const gain2 = ctx.createGain();
            gain2.gain.setValueAtTime(0.03, ctx.currentTime);
            gain2.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.4);
            gain2.gain.setValueAtTime(0.07, ctx.currentTime + 2.0);
            gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(ctx.currentTime);
            osc2.stop(ctx.currentTime + 3.5);
        } catch (_) { /* audio not available */ }
    }

    constructor(props: Record<string, never>) {
        super(props);
        this.state = { started: false, dead: false, score: 0, best: 0, night: false };
        this.raccoon = this.freshRaccoon();
    }

    freshRaccoon(): Raccoon {
        return {
            x: 60,
            y: GROUND_Y,
            vy: 0,
            onGround: true,
            ducking: false,
            legPhase: 0,
        };
    }

    componentDidMount() {
        const best = parseInt(localStorage.getItem('raccoon-best') || '0') || 0;
        this.setState({ best });
        window.addEventListener('keydown', this.handleKey);
        window.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('click', this.handleWindowClick);
        window.addEventListener('touchstart', this.handleWindowTouch, { passive: false });
        this.startIdleLoop();
        this.themeObserver = new MutationObserver(() => {
            if (!this.state.started || this.state.dead) this.draw();
        });
        this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    componentWillUnmount() {
        if (this.animId) cancelAnimationFrame(this.animId);
        if (this.idleAnimId) cancelAnimationFrame(this.idleAnimId);
        if (this.deathAnimId) cancelAnimationFrame(this.deathAnimId);
        if (this.audioCtx) { this.audioCtx.close(); this.audioCtx = null; }
        window.removeEventListener('keydown', this.handleKey);
        window.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('click', this.handleWindowClick);
        window.removeEventListener('touchstart', this.handleWindowTouch);
        if (this.themeObserver) this.themeObserver.disconnect();
    }

    startIdleLoop = () => {
        const loop = () => {
            const { started, dead } = this.state;
            if (!started || dead) {
                this.draw();
                this.idleAnimId = requestAnimationFrame(loop);
            } else {
                this.idleAnimId = null;
            }
        };
        this.idleAnimId = requestAnimationFrame(loop);
    };

    handleKey = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); this.jump(); }
        if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); this.duck(true); }
    };

    handleKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this.duck(false);
    };

    jump = () => {
        const { started, dead } = this.state;
        if (dead) { this.restart(); return; }
        if (!started) { this.start(); return; }
        if (this.raccoon.onGround) {
            this.raccoon.vy = JUMP_V;
            this.raccoon.onGround = false;
            this.raccoon.ducking = false;
            this.playJumpSound();
        }
    };

    duck = (on: boolean) => {
        if (window.innerWidth < 640) return;
        if (!this.state.started || this.state.dead) return;
        if (on && this.raccoon.onGround) this.raccoon.ducking = true;
        if (!on) this.raccoon.ducking = false;
    };

    handleWindowClick = () => { this.jump(); };

    handleWindowTouch = (e: TouchEvent) => {
        e.preventDefault();
        this.jump();
    };

    start = () => {
        this.setState({ started: true });
        this.lastTime = performance.now();
        this.raccoon.vy = JUMP_V;
        this.raccoon.onGround = false;
        this.animId = requestAnimationFrame(this.loop);
    };

    restart = () => {
        this.raccoon = this.freshRaccoon();
        this.obstacles = [];
        this.obstacleTimer = 0;
        this.nextObstacleIn = 1400;
        this.frameCount = 0;
        this.score = 0;
        this.speed = INITIAL_SPEED;
        this.nightMode = false;
        this.killerObstacle = null;
        this.lastSpeedTier = -1;
        this.speedFlash = 0;
        if (this.deathAnimId) { cancelAnimationFrame(this.deathAnimId); this.deathAnimId = null; }
        this.deathPixels = [];
        this.deathPixelTime = null;
        this.roadDashOffset = 0;
        this.cracks = [];
        this.crackTimer = 0;
        this.nextCrackIn = 2500 + Math.random() * 3000;
        this.lastTime = performance.now();
        this.setState({ started: true, dead: false, score: 0, night: false }, () => {
            this.animId = requestAnimationFrame(this.loop);
        });
    };

    loop = (now: number) => {
        if (this.state.dead) return;
        const dt = Math.min(now - (this.lastTime ?? now), 50);
        this.lastTime = now;
        this.frameCount++;
        const t = dt / (1000 / FPS); // normalise: t=1 at 60fps

        // score
        this.score += dt * 0.007;
        const scoreInt = Math.floor(this.score);

        // speed milestones — jump to next tier when score crosses a threshold
        let tier = -1;
        for (let i = 0; i < SPEED_MILESTONES.length; i++) { if (scoreInt >= SPEED_MILESTONES[i]) tier = i; }
        if (tier > this.lastSpeedTier) {
            this.speed = SPEED_AT_MILESTONE[tier];
            this.lastSpeedTier = tier;
            this.speedFlash = 1200; // show "FASTER!" for 1.2s
            this.playSpeedUpSound();
        }
        this.speedFlash = Math.max(0, this.speedFlash - dt);

        // night mode every 500 pts
        const nightMode = Math.floor(scoreInt / 500) % 2 === 1;
        this.nightMode = nightMode;

        // ground scroll
        this.groundOffset = (this.groundOffset + this.speed * t) % W;
        this.roadDashOffset = (this.roadDashOffset + this.speed * t) % 55;

        // road cracks
        this.cracks.forEach(c => { c.x -= this.speed * t; });
        this.cracks = this.cracks.filter(c => c.x > -120);
        this.crackTimer += dt;
        if (this.crackTimer >= this.nextCrackIn) {
            this.crackTimer = 0;
            this.nextCrackIn = 2500 + Math.random() * 3500;
            const cy = GROUND_Y + 5 + Math.random() * (H - GROUND_Y - 15);
            const pts: CrackPoint[] = [{ dx: 0, dy: 0 }];
            let cx = 0, cyOff = 0;
            const segs = 4 + Math.floor(Math.random() * 4);
            for (let i = 0; i < segs; i++) {
                cx += 6 + Math.random() * 10;
                cyOff += (Math.random() - 0.5) * 8;
                pts.push({ dx: cx, dy: cyOff });
                if (Math.random() < 0.4) {
                    const bx = cx + 4 + Math.random() * 8;
                    const by = cyOff + (Math.random() - 0.5) * 10;
                    pts.push({ dx: bx, dy: by });
                    pts.push({ dx: cx, dy: cyOff });
                }
            }
            this.cracks.push({ x: W + 20, y: cy, pts });
        }

        // clouds
        this.clouds.forEach(c => {
            c.x -= this.speed * 0.3 * t;
            if (c.x + c.w < 0) { c.x = W + 20; c.y = 20 + Math.random() * 40; c.w = 40 + Math.random() * 60; }
        });

        // raccoon physics
        if (!this.raccoon.onGround) {
            this.raccoon.vy += GRAVITY * t;
            this.raccoon.y += this.raccoon.vy * t;
            if (this.raccoon.y >= GROUND_Y) {
                this.raccoon.y = GROUND_Y;
                this.raccoon.vy = 0;
                this.raccoon.onGround = true;
            }
        }
        if (this.raccoon.onGround) this.raccoon.legPhase += this.speed * 0.15 * t;

        // obstacles
        this.obstacleTimer += dt;
        if (this.obstacleTimer >= this.nextObstacleIn) {
            const extraGap = this.spawnObstacle(scoreInt, nightMode);
            this.obstacleTimer = 0;
            this.nextObstacleIn = lerp(1000, 2000, Math.random()) * (INITIAL_SPEED / this.speed) + (extraGap ?? 0);
        }
        // move, filter, animate cones, and detect collision in one pass
        const survived: Obstacle[] = [];
        let killer: Obstacle | null = null;
        for (const o of this.obstacles) {
            o.x -= this.speed * (o.speedMult ?? 1) * t;
            if (o.x + o.w <= -10) continue;
            survived.push(o);
            if (o.type === 'cone') {
                if (!o.fallen && this.hitTest(o)) { o.fallen = true; o.fallAngle = 0; }
                else if (o.fallen && (o.fallAngle ?? 0) < Math.PI / 2) {
                    o.fallAngle = Math.min(Math.PI / 2, (o.fallAngle ?? 0) + 0.18 * t);
                }
            } else if (!killer && this.hitTest(o)) {
                killer = o;
            }
        }
        this.obstacles = survived;
        if (killer) {
            this.killerObstacle = killer;
            const best = Math.max(scoreInt, this.state.best);
            localStorage.setItem('raccoon-best', String(best));
            this.setState({ dead: true, score: scoreInt, best, night: nightMode }, () => {
                this.draw(scoreInt, nightMode);
                if (killer.type === 'motorcycle') {
                    this.initDeathPixels();
                    this.deathPixelTime = performance.now();
                    this.deathAnimId = requestAnimationFrame(this.animateDeathPixels);
                } else {
                    this.startIdleLoop();
                }
            });
            return;
        }

        this.setState({ score: scoreInt, night: nightMode }, () => {
            this.draw(scoreInt, nightMode);
            this.animId = requestAnimationFrame(this.loop);
        });
    };

    spawnObstacle(score: number, nightMode: boolean): number {
        const rand = Math.random();
        // motorcycle — color/night mode only, moves 1.25x faster; returns extra gap so player has time to react
        if (nightMode && rand < 0.30) {
            this.obstacles.push({ type: 'motorcycle', x: W + 200, y: GROUND_Y + 5 - 38, w: 58, h: 38, speedMult: 1.25 });
            this.playMotorcycleSound();
            return 2500;
        }
        // pterodactyls appear after score 300, disabled on mobile
        if (window.innerWidth >= 640 && score > 100 && rand < 0.40) {
            const heights = [GROUND_Y - 34, GROUND_Y - 52];
            const h = heights[Math.floor(Math.random() * heights.length)];
            const birdSpeed = Math.random() < 0.4 ? 1.5 : 1;

            this.obstacles.push({ type: 'bird', x: W + 20, y: h, w: 42, h: 28, speedMult: birdSpeed });
        } else if (rand < 0.30) {
            // 1, 2, or 3 cones in a row
            const count = Math.random() < 0.45 ? (Math.random() < 0.5 ? 2 : 3) : 1;
            let cx = W + 20;
            for (let i = 0; i < count; i++) {
                this.obstacles.push({ type: 'cone', x: cx, y: GROUND_Y + 5 - 28, w: 20, h: 28 });
                cx += 28;
            }
        } else if (rand < 0.45) {
            // alligator — 64×30 px, sits on ground
            this.obstacles.push({ type: 'alligator', x: W + 20, y: GROUND_Y + 5 - 30, w: 64, h: 30 });
        } else if (rand < 0.58) {
            // bear — 36×52 px, standing upright on ground
            this.obstacles.push({ type: 'bear', x: W + 20, y: GROUND_Y + 5 - 52, w: 36, h: 52 });
        } else if (rand < 0.72) {
            // road barrier — optionally one cone on ONE side only (left or right, never both)
            const bx = W + 20;
            this.obstacles.push({ type: 'barrier', x: bx, y: GROUND_Y + 5 - 42, w: 52, h: 42 });
            const coneChance = Math.random();
            if (coneChance < 0.35) {
                this.obstacles.push({ type: 'cone', x: bx - 30, y: GROUND_Y + 5 - 28, w: 20, h: 28 });
            } else if (coneChance < 0.65) {
                this.obstacles.push({ type: 'cone', x: bx + 62, y: GROUND_Y + 5 - 28, w: 20, h: 28 });
            }
        } else {
            // trashcan — 34×46 px, sits on ground
            this.obstacles.push({ type: 'trashcan', x: W + 20, y: GROUND_Y + 5 - 46, w: 34, h: 46 });
            if (Math.random() < 0.4) {
                this.obstacles.push({ type: 'trashcan', x: W + 58, y: GROUND_Y + 5 - 30, w: 22, h: 30 });
            }
        }
        return 0;
    }

    hitTest(o: Obstacle): boolean {
        const pad = 5;
        const S = 2;
        const spriteX = this.raccoon.x - 9;
        const rx1 = spriteX + 4 * S + pad;
        const rx2 = spriteX + 16 * S - pad;
        const ry1 = this.raccoon.ducking
            ? this.raccoon.y - 6 * S + pad
            : this.raccoon.y - 11 * S + pad;
        const ry2 = this.raccoon.y - pad;
        const ox1 = o.x + pad;
        const oy1 = o.y + pad;
        const ox2 = o.x + o.w - pad;
        const oy2 = o.y + o.h - pad;
        return rx1 < ox2 && rx2 > ox1 && ry1 < oy2 && ry2 > oy1;
    }

    draw(score = this.state.score, night = this.state.night) {
        const canvas = this.canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const { started, dead } = this.state;

        // background — match exact app colours from tailwind config
        const isDark = this.isDarkMode();
        const bg = isDark ? (night ? '#1a1a1a' : '#333333') : (night ? '#1a1a2e' : '#f0f2f5');
        const fg = (isDark || night) ? '#e0e0e0' : '#1a1a1a';
        ctx.clearRect(0, 0, W, H);

        // clouds
        ctx.fillStyle = isDark ? (night ? '#222222' : '#444444') : (night ? '#2a2a4a' : '#d8dce2');
        this.clouds.forEach(c => {
            ctx.beginPath();
            ctx.ellipse(c.x + c.w * 0.3, c.y, c.w * 0.3, 10, 0, 0, Math.PI * 2);
            ctx.ellipse(c.x + c.w * 0.6, c.y - 4, c.w * 0.25, 10, 0, 0, Math.PI * 2);
            ctx.ellipse(c.x + c.w * 0.7, c.y + 2, c.w * 0.2, 8, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // horizon / road-start edge line
        const roadTop = GROUND_Y - 20;
        ctx.strokeStyle = isDark ? '#777777' : (night ? '#606080' : '#888888');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, roadTop);
        ctx.lineTo(W, roadTop);
        ctx.stroke();

        // scrolling lane dashes in the lower portion of the road
        ctx.strokeStyle = night ? '#e8e840' : (isDark ? '#666666' : '#c8c8c8');
        ctx.lineWidth = 2;
        ctx.setLineDash([30, 25]);
        ctx.lineDashOffset = this.roadDashOffset;
        ctx.beginPath();
        ctx.moveTo(0, (GROUND_Y - 20 + H) / 2);
        ctx.lineTo(W, (GROUND_Y - 20 + H) / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // road cracks
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.45)' : (night ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)');
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.cracks.forEach(c => {
            ctx.beginPath();
            ctx.moveTo(c.x + c.pts[0].dx, c.y + c.pts[0].dy);
            for (let i = 1; i < c.pts.length; i++) {
                ctx.lineTo(c.x + c.pts[i].dx, c.y + c.pts[i].dy);
            }
            ctx.stroke();
        });

        // obstacles
        this.obstacles.forEach(o => {
            if (o.type === 'cone') {
                const coneOrange = night ? '#ff6600' : (isDark ? '#aaaaaa' : '#535353');
                const angle = o.fallen ? (o.fallAngle ?? Math.PI / 2) : 0;
                // pivot at base centre (o.x+10, o.y+28)
                const px = o.x + 10;
                const py = o.y + 28;
                ctx.save();
                ctx.translate(px, py);
                ctx.rotate(angle);
                ctx.fillStyle = isDark ? '#555555' : '#222222';
                ctx.fillRect(-9, -5, 18, 5);
                ctx.fillStyle = coneOrange;
                ctx.beginPath();
                ctx.moveTo(0,  -28);
                ctx.lineTo(9,  -5);
                ctx.lineTo(-9, -5);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(-5, -15);
                ctx.lineTo(5,  -15);
                ctx.lineTo(7,  -10);
                ctx.lineTo(-7, -10);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            } else if (o.type === 'barrier') {
                const barOrange = night ? '#ff6600' : (isDark ? '#aaaaaa' : '#535353');
                const legColor  = isDark ? '#777777' : '#444444';
                ctx.fillStyle = legColor;
                ctx.beginPath();
                ctx.moveTo(o.x + 4,  o.y + 42);
                ctx.lineTo(o.x + 12, o.y + 42);
                ctx.lineTo(o.x + 20, o.y + 26);
                ctx.lineTo(o.x + 13, o.y + 26);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(o.x + 40, o.y + 42);
                ctx.lineTo(o.x + 48, o.y + 42);
                ctx.lineTo(o.x + 39, o.y + 26);
                ctx.lineTo(o.x + 32, o.y + 26);
                ctx.closePath();
                ctx.fill();
                const drawStripe = (yTop: number, h: number) => {
                    ctx.fillStyle = barOrange;
                    ctx.fillRect(o.x, yTop, 52, h);
                    ctx.fillStyle = '#ffffff';
                    for (let s = 0; s < 5; s++) {
                        ctx.beginPath();
                        ctx.moveTo(o.x + 4 + s * 10, yTop);
                        ctx.lineTo(o.x + 9 + s * 10, yTop);
                        ctx.lineTo(o.x + 4 + s * 10, yTop + h);
                        ctx.lineTo(o.x - 1 + s * 10, yTop + h);
                        ctx.closePath();
                        ctx.fill();
                    }
                };
                drawStripe(o.y + 6, 10);
                drawStripe(o.y + 20, 8);
            } else if (o.type === 'alligator') {
                ctx.fillStyle = night ? '#5ab55a' : (isDark ? '#b0b0b0' : '#535353');
                ctx.fillRect(o.x + 14, o.y + 6, 36, 14);
                ctx.fillRect(o.x + 2, o.y + 4, 16, 14);
                ctx.fillRect(o.x, o.y + 4, 10, 7);
                const bite = (Math.sin(this.frameCount * 0.06) + 1) / 2 * 7;
                ctx.fillRect(o.x + 2, o.y + 12 + bite, 10, 5);
                ctx.fillRect(o.x + 48, o.y + 8, 10, 10);
                ctx.fillRect(o.x + 56, o.y + 11, 8, 5);
                for (let i = 0; i < 5; i++) {
                    const sx = o.x + 16 + i * 8;
                    ctx.beginPath();
                    ctx.moveTo(sx, o.y + 8);
                    ctx.lineTo(sx + 7, o.y + 8);
                    ctx.lineTo(sx + 3.5, o.y);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.fillRect(o.x + 8,  o.y + 18, 6, 10);
                ctx.fillRect(o.x + 18, o.y + 18, 6, 10);
                ctx.fillRect(o.x + 30, o.y + 18, 6, 10);
                ctx.fillRect(o.x + 40, o.y + 18, 6, 10);
                ctx.fillStyle = bg;
                ctx.beginPath();
                ctx.arc(o.x + 10, o.y + 9, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = night ? '#5ab55a' : (isDark ? '#b0b0b0' : '#535353');
            } else if (o.type === 'bear') {
                ctx.fillStyle = night ? '#6B4226' : (isDark ? '#b0b0b0' : '#535353');
                ctx.beginPath();
                ctx.arc(o.x + 12, o.y + 6, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(o.x + 16, o.y + 17, 13, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.ellipse(o.x + 5, o.y + 20, 7, 5, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillRect(o.x + 8, o.y + 28, 22, 20);
                const maul = Math.sin(this.frameCount * 0.06);
                const frontSwipe = Math.max(0,  maul) * 16;
                const backSwipe  = Math.max(0, -maul) * 10;
                ctx.fillRect(o.x, o.y + 30 - frontSwipe, 8, 13);
                ctx.fillRect(o.x + 28, o.y + 32 - backSwipe, 8, 13);
                ctx.fillRect(o.x + 9,  o.y + 44, 10, 8);
                ctx.fillRect(o.x + 21, o.y + 44, 10, 8);
                ctx.fillStyle = bg;
                ctx.beginPath();
                ctx.arc(o.x + 10, o.y + 15, 2.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(o.x + 2, o.y + 19, 2, 0, Math.PI * 2);
                ctx.fill();
            } else if (o.type === 'trashcan') {
                const canColor = night ? '#1a4a8a' : (isDark ? '#b0b0b0' : '#535353');
                ctx.fillStyle = canColor;
                ctx.fillRect(o.x + 1, o.y, 32, 6);
                ctx.fillRect(o.x + 3, o.y + 5, 28, 41);
                ctx.fillRect(o.x, o.y + 14, 4, 8);
                ctx.fillRect(o.x + 30, o.y + 14, 4, 8);
                ctx.fillStyle = bg;
                ctx.fillRect(o.x + 3, o.y + 16, 28, 2);
                ctx.fillRect(o.x + 3, o.y + 26, 28, 2);
                ctx.fillRect(o.x + 3, o.y + 36, 28, 2);
                ctx.fillStyle = canColor;
                ctx.save();
                ctx.translate(o.x + 38, o.y + 6);
                ctx.rotate(0.75);
                ctx.fillRect(-15, -4, 30, 8);
                ctx.fillRect(-3, -8, 6, 5);
                ctx.restore();
                ctx.strokeStyle = canColor;
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                const st = this.frameCount * 0.005;
                [8, 17, 26].forEach((sx, i) => {
                    const yOff = ((st + i * 0.6) % 1) * 24;
                    ctx.globalAlpha = (1 - yOff / 24) * 0.85;
                    ctx.beginPath();
                    ctx.moveTo(o.x + sx, o.y - yOff);
                    ctx.quadraticCurveTo(o.x + sx + 6, o.y - 9 - yOff, o.x + sx, o.y - 16 - yOff);
                    ctx.quadraticCurveTo(o.x + sx - 6, o.y - 22 - yOff, o.x + sx, o.y - 28 - yOff);
                    ctx.stroke();
                });
                ctx.globalAlpha = 1;
            } else if (o.type === 'motorcycle') {
                const mc = '#ff4400';
                ctx.fillStyle = mc;
                ctx.beginPath();
                ctx.arc(o.x + 46, o.y + 28, 10, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(o.x + 12, o.y + 28, 10, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = bg;
                ctx.beginPath(); ctx.arc(o.x + 46, o.y + 28, 3, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(o.x + 12, o.y + 28, 3, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = bg;
                ctx.lineWidth = 1.5;
                const spin = (this.frameCount * 0.18) % Math.PI;
                ([
                    [o.x + 12, o.y + 28],
                    [o.x + 46, o.y + 28],
                ] as [number, number][]).forEach(([wx, wy]) => {
                    for (let s = 0; s < 3; s++) {
                        const a = spin + s * (Math.PI / 3);
                        ctx.beginPath();
                        ctx.moveTo(wx + Math.cos(a) * 8, wy + Math.sin(a) * 8);
                        ctx.lineTo(wx - Math.cos(a) * 8, wy - Math.sin(a) * 8);
                        ctx.stroke();
                    }
                });
                ctx.fillStyle = mc;
                ctx.beginPath();
                ctx.moveTo(o.x + 46, o.y + 18);
                ctx.lineTo(o.x + 38, o.y + 10);
                ctx.lineTo(o.x + 20, o.y + 12);
                ctx.lineTo(o.x + 12, o.y + 18);
                ctx.lineTo(o.x + 18, o.y + 22);
                ctx.lineTo(o.x + 40, o.y + 20);
                ctx.closePath();
                ctx.fill();
                ctx.fillRect(o.x + 24, o.y + 8, 14, 8);
                ctx.fillRect(o.x + 10, o.y + 12, 5, 14);
                ctx.fillRect(o.x + 4,  o.y + 11, 10, 4);
                ctx.fillRect(o.x + 4,  o.y + 10, 3, 7);
                ctx.beginPath();
                ctx.ellipse(o.x + 32, o.y + 5, 9, 11, -0.35, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(o.x + 24, o.y - 4, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = bg;
                ctx.fillRect(o.x + 18, o.y - 4, 8, 4);
                ctx.fillStyle = 'rgba(200,200,200,0.5)';
                [6, 12, 18].forEach(ex => {
                    ctx.beginPath();
                    ctx.arc(o.x + 55 + ex, o.y + 26, 3 + ex * 0.2, 0, Math.PI * 2);
                    ctx.fill();
                });
            } else {
                // eagle
                ctx.fillStyle = night ? '#b8950a' : (isDark ? '#b0b0b0' : '#535353');
                const wingUp = Math.floor(this.frameCount / 45) % 2 === 0;
                ctx.beginPath();
                ctx.ellipse(o.x + 22, o.y + 14, 11, 7, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(o.x + 9, o.y + 11, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(o.x + 5, o.y + 9);
                ctx.lineTo(o.x, o.y + 12);
                ctx.lineTo(o.x + 3, o.y + 16);
                ctx.lineTo(o.x + 6, o.y + 14);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(o.x + 31, o.y + 12);
                ctx.lineTo(o.x + 42, o.y + 7);
                ctx.lineTo(o.x + 42, o.y + 21);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = bg;
                ctx.beginPath();
                ctx.arc(o.x + 10, o.y + 10, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = night ? '#b8950a' : (isDark ? '#b0b0b0' : '#535353');
                if (wingUp) {
                    ctx.beginPath();
                    ctx.moveTo(o.x + 12, o.y + 10);
                    ctx.lineTo(o.x + 21, o.y - 6);
                    ctx.lineTo(o.x + 30, o.y + 10);
                    ctx.closePath();
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(o.x + 12, o.y + 18);
                    ctx.lineTo(o.x + 21, o.y + 32);
                    ctx.lineTo(o.x + 30, o.y + 18);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        });

        // raccoon
        const glowColor = (!started || dead) ? (isDark ? '#ffffff' : '#111111') : null;
        this.drawRaccoon(ctx, isDark || night, isDark, glowColor);

        // text outline for readability on transparent canvas
        const outlineColor = isDark ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.95)';
        ctx.save();
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';

        const strokeThenFill = (text: string, x: number, y: number) => {
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
        };

        // score
        if (started) {
            ctx.fillStyle = fg;
            ctx.font = `bold 16px monospace`;
            ctx.textAlign = 'right';
            const scoreStr = String(score).padStart(5, '0');
            strokeThenFill(`HI ${String(this.state.best).padStart(5, '0')}  ${scoreStr}`, W - 12, 24);
        }

        // "FASTER!" flash on speed milestone
        if (started && !dead && this.speedFlash > 0) {
            const alpha = Math.min(1, this.speedFlash / 300);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ff4444';
            ctx.font = `bold 22px monospace`;
            ctx.textAlign = 'center';
            strokeThenFill('FASTER!', W / 2, 50);
            ctx.globalAlpha = 1;
        }

        // start overlay
        if (!started) {
            ctx.fillStyle = fg;
            ctx.font = `14px monospace`;
            ctx.textAlign = 'center';
            strokeThenFill('Press \u23b5 or \ud83d\uddb1\ufe0f click to start', W / 2, 70);
        }

        // dead overlay
        if (dead) {
            ctx.fillStyle = fg;
            ctx.font = `bold 18px monospace`;
            ctx.textAlign = 'center';
            strokeThenFill('GAME OVER', W / 2, 55);
            ctx.font = `13px monospace`;
            strokeThenFill('Press \u23b5 or \ud83d\uddb1\ufe0f click to restart', W / 2, 82);
        }

        ctx.restore();
    }

    drawEating(ctx: CanvasRenderingContext2D, night: boolean, isDark: boolean) {
        const ko = this.killerObstacle!;
        const grey1 = night ? '#b8b8b8' : (isDark ? '#999999' : '#767676');
        const grey2 = night ? '#686868' : (isDark ? '#484848' : '#3a3a3a');
        const grey3 = night ? '#d8d8d8' : (isDark ? '#c0c0c0' : '#b8b8b8');
        const black = '#111111';

        ctx.fillStyle = grey2;
        ctx.fillRect(ko.x - 26, ko.y - 16, 6, 11);
        ctx.fillStyle = grey3;
        ctx.fillRect(ko.x - 26, ko.y - 7, 6, 4);
        ctx.fillStyle = grey2;
        ctx.fillRect(ko.x - 26, ko.y - 3, 6, 4);
        ctx.fillStyle = grey1;
        ctx.fillRect(ko.x - 22, ko.y, 26, 10);
        ctx.fillStyle = grey2;
        ctx.fillRect(ko.x - 18, ko.y + 10, 5, 10);
        ctx.fillRect(ko.x - 9,  ko.y + 10, 5, 10);
        ctx.fillStyle = black;
        ctx.fillRect(ko.x - 21, ko.y + 19, 8, 3);
        ctx.fillRect(ko.x - 12, ko.y + 19, 8, 3);
        ctx.fillStyle = black;
        ctx.fillRect(ko.x + 2,  ko.y + 1, 5, 5);
        ctx.fillRect(ko.x + 10, ko.y + 1, 5, 5);
        ctx.fillStyle = black;
        ctx.fillRect(ko.x + 3,  ko.y - 6, 4, 7);
        ctx.fillRect(ko.x + 11, ko.y - 6, 4, 7);
        ctx.fillStyle = grey1;
        ctx.fillRect(ko.x + 4,  ko.y - 5, 2, 4);
        ctx.fillRect(ko.x + 12, ko.y - 5, 2, 4);

        const bw = 62, bh = 32;
        const bx = ko.x - 28;
        const by = ko.y - 58;
        const cx = bx + bw / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.roundRect(bx + 3, by + 3, bw, bh, 8);
        ctx.fill();
        ctx.fillStyle = '#fffce8';
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 8);
        ctx.fill();
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fffce8';
        ctx.beginPath();
        ctx.moveTo(cx - 8, by + bh);
        ctx.lineTo(cx,     by + bh + 14);
        ctx.lineTo(cx + 8, by + bh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 8, by + bh);
        ctx.lineTo(cx,     by + bh + 14);
        ctx.lineTo(cx + 8, by + bh);
        ctx.stroke();
        ctx.fillStyle = '#fffce8';
        ctx.fillRect(cx - 8, by + bh - 2, 16, 4);
        ctx.fillStyle = '#1a1a1a';
        ctx.font = 'bold 18px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('YUM!', cx, by + bh / 2);
        ctx.textBaseline = 'alphabetic';
    }

    initDeathPixels() {
        const d = this.raccoon;
        const S = 2;
        const ox = d.x - 9;
        const oy = d.y - 17 * S;
        const night = this.nightMode;
        const isDark = this.isDarkMode();
        const C = this.getRaccoonColors(night, isDark);
        const l = Math.sin(d.legPhase) > 0;
        const legs = l ? LEGS_A : LEGS_B;
        this.deathPixels = [];
        const addGrid = (grid: number[][], gox: number, goy: number) => {
            grid.forEach((row, r) => row.forEach((c, col) => {
                if (!c) return;
                const color = C[c];
                if (!color) return;
                this.deathPixels.push({
                    x: gox + col * S,
                    y: goy + r * S,
                    vx: -(1.5 + Math.random() * 4.5),
                    vy: -(0.5 + Math.random() * 3.5),
                    color,
                    size: S,
                });
            }));
        };
        addGrid(BODY_SPRITE, ox, oy);
        addGrid(legs, ox, oy + 13 * S);
    }

    animateDeathPixels = (now: number) => {
        if (!this.state.dead || !this.deathPixels.length) return;
        const dt = Math.min(now - (this.deathPixelTime ?? now), 50);
        this.deathPixelTime = now;
        const t = dt / (1000 / FPS);
        this.deathPixels.forEach(p => {
            p.vy += GRAVITY * 0.6 * t;
            p.x += p.vx * t;
            p.y += p.vy * t;
        });
        this.deathPixels = this.deathPixels.filter(p => p.y < H + 20 && p.x > -30);
        this.draw(this.state.score, this.state.night);
        if (this.deathPixels.length > 0) {
            this.deathAnimId = requestAnimationFrame(this.animateDeathPixels);
        } else {
            this.deathAnimId = null;
            this.startIdleLoop();
        }
    };

    drawRaccoon(ctx: CanvasRenderingContext2D, night: boolean, isDark: boolean, glowColor: string | null = null) {
        // eating from trashcan pose overrides normal drawing
        if (this.killerObstacle && this.killerObstacle.type === 'trashcan') {
            this.drawEating(ctx, night, isDark);
            return;
        }
        // motorcycle kill — draw dissipating pixels instead
        if (this.killerObstacle && this.killerObstacle.type === 'motorcycle') {
            if (this.deathPixels && this.deathPixels.length) {
                this.deathPixels.forEach(p => {
                    ctx.fillStyle = p.color;
                    ctx.fillRect(p.x, p.y, p.size, p.size);
                });
            }
            return;
        }

        const d = this.raccoon;
        const S = 2;
        const pulse = glowColor ? 0.8 + 0.2 * Math.sin(performance.now() / 200) : 0;

        // 0=transparent 1=mid-grey 2=dark-grey 3=light-grey 4=black 5=white/eyes
        const C = this.getRaccoonColors(night, isDark);

        const draw = (grid: number[][], ox: number, oy: number) => {
            grid.forEach((row, r) => row.forEach((c, col) => {
                if (!c) return;
                const isEye = glowColor && c === 5 && ((r === 7 && (col === 15 || col === 19)) || (r === 2 && (col === 11 || col === 13)));
                if (isEye) {
                    const ex = ox + col * S;
                    const ey = oy + r * S;
                    ctx.save();
                    ctx.shadowColor = glowColor!;
                    ctx.shadowBlur = 120 * pulse;
                    ctx.fillStyle = glowColor!;
                    ctx.globalAlpha = 0.8 * pulse;
                    ctx.beginPath();
                    ctx.arc(ex + S / 2, ey + S / 2, S * 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                    ctx.save();
                    ctx.shadowColor = glowColor!;
                    ctx.shadowBlur = 90 * pulse;
                    ctx.fillStyle = glowColor!;
                    ctx.globalAlpha = 1;
                    ctx.fillRect(ex, ey, S, S);
                    ctx.restore();
                } else {
                    const color = C[c];
                    if (color) ctx.fillStyle = color;
                    ctx.fillRect(ox + col * S, oy + r * S, S, S);
                }
            }));
        };

        const ox = d.x - 9;

        if (d.ducking) {
            const duck: number[][] = [
                [2,1,2,1,2,0,0,0,0,0,0,0,0,0,4,0,4,0,0,0],
                [2,1,2,1,2,1,1,1,1,1,1,2,2,1,2,2,0,0,0,0],
                [2,1,2,1,2,1,1,1,1,1,2,5,4,5,2,1,0,0,0,0],
                [2,1,2,1,1,1,1,1,1,2,4,4,2,1,0,0,0,0,0,0],
                [0,0,1,1,1,3,3,1,1,1,1,1,0,0,0,0,0,0,0,0],
                [0,0,4,1,4,0,0,4,1,4,0,0,0,0,0,0,0,0,0,0],
            ];
            draw(duck, ox, d.y - 6 * S);
            return;
        }

        const l = Math.sin(d.legPhase) > 0;

        const oy = d.y - 17 * S;
        draw(BODY_SPRITE, ox, oy);
        draw(l ? LEGS_A : LEGS_B, ox, oy + 13 * S);
    }

    render() {
        return (
            <canvas
                ref={this.canvasRef}
                width={W}
                height={H}
                style={{ cursor: 'pointer', display: 'block', width: '80vw', maxWidth: '800px', height: 'auto', outline: 'none', WebkitTapHighlightColor: 'transparent', imageRendering: 'pixelated', touchAction: 'none' }}
            />
        );
    }
}
