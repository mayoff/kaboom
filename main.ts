namespace SpriteKind {
    export const Paddle = SpriteKind.create();
    export const Bucket = SpriteKind.create();
    export const Bomber = SpriteKind.create();
    export const Bomb = SpriteKind.create();
}

class BombPose {
    sprite: Sprite;
    vy: number = 0;

    constructor(x: number, y: number) {
        this.sprite = sprites.create(assets.image`bomb`, SpriteKind.Bomb);
        this.sprite.setPosition(x, y);
    }

    advance(elapsed: TimeInterval) {
        this.vy = Math.min(this.vy + GameState.gravity * elapsed, GameState.bombMaxSpeed);
        this.sprite.y = Math.min(this.sprite.y + this.vy * elapsed, scene.screenHeight() - this.sprite.height / 2);
    }
}

class BomberPose {
    sprite: Sprite;
    isHoldingBomb: boolean = false;

    constructor() {
        this.sprite = sprites.create(assets.image`bomber`, SpriteKind.Bomber);
        this.sprite.setPosition(scene.screenWidth() / 3, 19);
    }
}

class PlayerPose {
    paddle: Sprite;
    buckets: Sprite[];
    vx: number = 0;
    vxTarget: number = 0;

    constructor() {
        this.paddle = sprites.create(assets.image`paddlePlaceholder`, SpriteKind.Paddle);
        this.paddle.setFlag(SpriteFlag.Invisible, true);
        this.paddle.setPosition(scene.screenWidth() / 2, scene.screenHeight() - 4)

        this.buckets = [];
        for (let i = 0; i < 3; ++i) {
            const bucket = sprites.create(assets.image`bucket`, SpriteKind.Bucket);
            this.buckets.push(bucket);
            bucket.setPosition(this.paddle.x, this.paddle.y - (i * (bucket.height + 2)) - bucket.height / 2);
        }

        // Reverse the buckets so the lowest bucket gets removed first.
        this.buckets.reverse();
    }

    advance(elapsed: TimeInterval) {
        if (this.buckets.length == 0) { return; }
        this.vx = (this.vx + this.vxTarget) / 2;
        this.paddle.x = Math.max(
            this.buckets[0].width / 2,
            Math.min(
                this.paddle.x + this.vx * elapsed,
                scene.screenWidth() - this.buckets[0].width / 2));
        this.buckets.forEach(function(bucket: Sprite, index: number) {
           bucket.x = this.paddle.x; 
        });
    }
}

enum PhaseType {
    Prepping,
    Bombing,
    Exploding,
    Lost
}

class PreppingPhase {
    type: PhaseType.Prepping = PhaseType.Prepping;

    constructor() { }
}

class BombingPhase {
    type: PhaseType.Bombing = PhaseType.Bombing;

    bombs: BombPose[];
    bomberTargetX: number = 0;

    constructor(bomberTargetX: number) {
        this.bombs = [];
        this.bomberTargetX = bomberTargetX;
    }
}

class ExplodingPhase {
    type: PhaseType.Exploding = PhaseType.Exploding;

    bombs: Sprite[];
    explosion: Sprite;

    constructor(bombs: Sprite[]) {
        this.explosion = bombs.pop();
        this.bombs = bombs;

        this.explosion.setImage(assets.image`explosion`);
    }
}

class LostPhase {
    type: PhaseType.Lost = PhaseType.Lost;

    constructor() { }
}

type AbsoluteTime = number;
type TimeInterval = number;
type Phase = PreppingPhase | BombingPhase | ExplodingPhase | LostPhase;

class GameState {
    level: number;
    phaseEndTime: AbsoluteTime;

    timeUpdated: AbsoluteTime;
    phase: Phase;
    player: PlayerPose;
    bomber: BomberPose;
    undroppedBombCount: number; // not including the bomb held by the bomber, if any

    constructor(now: AbsoluteTime) {
        this.level = 0;
        this.phaseEndTime = 0;
        this.timeUpdated = 0;
        this.player = new PlayerPose();
        this.bomber = new BomberPose();
        this.undroppedBombCount = 0;
        this.phase = new BombingPhase(this.bomber.sprite.x);

        this.advanceLevelIfNeeded(now);
    }

    setPlayerVelocityFromController() {
        const speed = controller.A.isPressed() ? GameState.paddleSpeedFast : GameState.paddleSpeedSlow;
        if (controller.left.isPressed()) {
            this.player.vxTarget = -speed;
        } else if (controller.right.isPressed()) {
            this.player.vxTarget = speed;
        } else {
            this.player.vxTarget = 0;
        }
    }

    update(now: AbsoluteTime) {
        const elapsed = now - this.timeUpdated;
        this.advancePlayerPose(elapsed);
        this.advanceBomberPosition(elapsed);
        this.advanceBombPoses(elapsed);
        this.catchBombs();
        this.startExplodingIfNeeded(now);
        this.continueExplodingIfNeeded(now);
        this.pickUpBombIfNeeded(now);
        this.dropBombIfNeeded(now);
        this.finishPreppingIfNeeded(now);
        this.advanceLevelIfNeeded(now);
        this.timeUpdated = now;
    }

    advancePlayerPose(elapsed: TimeInterval) {
        if (this.phase.type == PhaseType.Prepping || this.phase.type == PhaseType.Bombing) {
            this.player.advance(elapsed);
        }
    }

    advanceBomberPosition(elapsed: TimeInterval) {
        if (
            (this.undroppedBombCount <= 0 && !this.bomber.isHoldingBomb)
            || this.phase.type != PhaseType.Bombing
        ) {
            return;
        }

        if (Math.abs(this.bomber.sprite.x - this.phase.bomberTargetX) < 1) {
            this.phase.bomberTargetX = this.newBomberTargetX();
        } else if (this.bomber.sprite.x < this.phase.bomberTargetX) {
            this.bomber.sprite.x = Math.min(this.bomber.sprite.x + GameState.bomberSpeed * elapsed, this.phase.bomberTargetX);
        } else {
            this.bomber.sprite.x = Math.max(this.phase.bomberTargetX, this.bomber.sprite.x - GameState.bomberSpeed * elapsed);
        }
    }    

    newBomberTargetX(): number {
        const bWidth = this.bomber.sprite.width;
        const margin = 2 * bWidth;
        const proposal = bWidth / 2 + Math.random() * (scene.screenWidth() - bWidth - 2 * margin);
        const adjustment = proposal <= this.bomber.sprite.x ? 0 : 2 * margin;
        return proposal + adjustment;
    }

    advanceBombPoses(elapsed: TimeInterval) {
        if (this.phase.type != PhaseType.Bombing) { return; }
        this.phase.bombs.forEach(function(bomb: BombPose, index: number) {
            bomb.advance(elapsed);
        });
    }

    catchBombs() {
        if (this.phase.type != PhaseType.Bombing) { return; }

        let uncaughtBombs: BombPose[] = [];
        let caughtBombs: BombPose[] = [];
        for (let bomb of this.phase.bombs) {
            let isCaught = false;
            for (let bucket of this.player.buckets) {
                if (bomb.sprite.overlapsWith(bucket)) {
                    isCaught = true;
                    break;
                }
            }
            (isCaught ? caughtBombs : uncaughtBombs).push(bomb);
        }

        this.phase.bombs = uncaughtBombs;

        for (let bomb of caughtBombs) {
            bomb.sprite.destroy();
            info.changeScoreBy(1);
        }
    }

    startExplodingIfNeeded(now: AbsoluteTime) {
        if (this.phase.type != PhaseType.Bombing) { return; }
        const bombs = this.phase.bombs;
        if (bombs.every(bomb => bomb.sprite.y < scene.screenHeight() - bomb.sprite.height / 2)) {
            return;
        }
        let bucket = this.player.buckets.pop();
        bucket.destroy();
        this.phaseEndTime = now + GameState.singleExplosionDuration;
        let bombSprites = bombs.map((bomb) => bomb.sprite);
        bombSprites.reverse();
        this.phase = new ExplodingPhase(bombSprites);
    }

    continueExplodingIfNeeded(now: AbsoluteTime) {
        if (
            now < this.phaseEndTime
            || this.phase.type != PhaseType.Exploding
        ) { return; }

        this.phase.explosion.destroy();

        if (this.phase.bombs.length > 0) {
            this.phase = new ExplodingPhase(this.phase.bombs);
            this.phaseEndTime = now + GameState.singleExplosionDuration;
            return;
        }

        if (this.player.buckets.length > 0) {
            this.phase = new PreppingPhase();
            this.phaseEndTime = now + GameState.preppingDuration;
            return;
        }

        this.phase = new LostPhase();
        this.phaseEndTime = 1e100;
        game.over(false, effects.splatter);
    }

    pickUpBombIfNeeded(now: AbsoluteTime) {
        if (
            now < this.phaseEndTime
            || this.bomber.isHoldingBomb
            || this.undroppedBombCount <= 0
            || this.phase.type != PhaseType.Bombing
        ) { return; }

        this.undroppedBombCount -= 1;
        this.bomber.isHoldingBomb = true;
        this.bomber.sprite.setImage(assets.image`bomberWithBomb`);
        this.phaseEndTime = now + GameState.bombHoldingDuration;
    }

    dropBombIfNeeded(now: AbsoluteTime) {
        if (
            now < this.phaseEndTime
            || !this.bomber.isHoldingBomb
            || this.phase.type != PhaseType.Bombing
        ) { return; }

        this.bomber.isHoldingBomb = false;
        this.bomber.sprite.setImage(assets.image`bomber`);
        const bomb = new BombPose(this.bomber.sprite.x, this.bomber.sprite.y + 8);
        this.phase.bombs.push(bomb);
        this.phaseEndTime = now + GameState.reloadingDuration;
    }

    finishPreppingIfNeeded(now: AbsoluteTime) {
        if (
            now < this.phaseEndTime
            || this.phase.type != PhaseType.Prepping
        ) { return; }
        
        this.phase = new BombingPhase(this.bomber.sprite.x);
        this.phaseEndTime = now + (this.bomber.isHoldingBomb ? GameState.bombHoldingDuration : GameState.reloadingDuration);
    }

    advanceLevelIfNeeded(now: AbsoluteTime) {
        if (this.phase.type != PhaseType.Bombing) { return; }
        if (
            now < this.phaseEndTime
            || this.phase.type != PhaseType.Bombing
            || this.phase.bombs.length > 0
            || this.bomber.isHoldingBomb
            || this.undroppedBombCount > 0
        ) {
            return;
        }

        this.phaseEndTime = now + GameState.preppingDuration;
        this.phase = new PreppingPhase();
        this.level += 1;
        this.undroppedBombCount = GameState.bombCountForLevel(this.level);
    }

    static preppingDuration: TimeInterval = 0.5;
    static bomberSpeed: number = 80; // points per second
    static gravity: number = 200; // points per second per second
    static bombMaxSpeed: number = 200; // points per second
    static singleExplosionDuration: TimeInterval = 0.3;
    static bombHoldingDuration: TimeInterval = 0.2;
    static reloadingDuration: TimeInterval = 0.2;
    static paddleSpeedSlow: number = 200;
    static paddleSpeedFast: number = 300;
    static bombCountForLevel(level: number): number {
        return 5 * (level + 1);
    }
}

scene.setBackgroundImage(assets.image`background`);

let gameState = new GameState(game.runtime() / 1000.0);

for (let input of [controller.A, controller.left ,controller.right]) {
    input.onEvent(ControllerButtonEvent.Pressed, function() {
        gameState.setPlayerVelocityFromController();
    })
    input.onEvent(ControllerButtonEvent.Released, function() {
        gameState.setPlayerVelocityFromController();
    })
}

game.onUpdate(function() {
    gameState.update(game.runtime() / 1000.0);
})
