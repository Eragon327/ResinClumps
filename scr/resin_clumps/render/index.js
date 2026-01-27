import { Event, Events } from "../core/event.js";
import { manager } from "../core/manager.js";
import { HelperUtils } from "../utils/helpers.js";

const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json");
const displayRadius = configFile.get("displayRadius", 70);
const particleLifetime = configFile.get("particleLifetime", 1550);
const blacklist = configFile.get('BlackList', []);
const scanSpeed = configFile.get("scanSpeed", 3000);
const renderSpeed = configFile.get("renderSpeed", 3000);
const displayInterval = configFile.get("displayInterval", 50);
const retryInterval = configFile.get("retryInterval", 5000);
configFile.close();

const shortTime = 50;  // 渲染循环与粒子生命周期的时间差, 确保粒子不会闪烁

class RenderMgr {
    constructor() {
        this.renders = new Map(); // structName -> { mode, layerIndex, particles: [], grids: {} }
        this.interrupt = false;
        this.ps = new ParticleSpawner(displayRadius, false, false);
    }

    init() {
        Event.listen(Events.RENDER_SET_RENDER_MODE, this.setMode.bind(this));
        Event.listen(Events.RENDER_SET_LAYER_INDEX, this.setLayerIndex.bind(this));
        Event.listen(Events.RENDER_UPDATE_DATA, this.saveData.bind(this));
        Event.listen(Events.MANAGER_REMOVE_STRUCTURE, this.syncStructures.bind(this));
        Event.listen(Events.MANAGER_ADD_STRUCTURE, this.syncStructures.bind(this));
        Event.listen(Events.RENDER_GET_MATERIALS, this.getMaterials.bind(this));
        Event.listen(Events.RENDER_STOP_ALL_RENDERING, () => { this.interrupt = true; });
        Event.listen(Events.RENDER_REFRESH_GRIDS, this.refresh.bind(this));

        this.syncStructures();

        const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json");
        const structures = database.get('structures', {});
        database.close();

        for (const [name, item] of Object.entries(structures)) {
            if (!this.renders.has(name)) continue;
            const renderData = this.renders.get(name);
            const size = manager.getSize(name);
            if (!size) continue;
            
            const max = size.y - 1;
            if (item.layerIndex < 0) {
                renderData.mode = RenderMode.Off;
                renderData.layerIndex = 0;
            } else if (item.layerIndex <= max) {
                renderData.mode = item.mode ?? RenderMode.All;
                renderData.layerIndex = item.layerIndex ?? 0;
            } else {
                renderData.mode = RenderMode.Off;
                renderData.layerIndex = max;
            }
        }

        // Initial scan for everything
        this.refresh();
        this.saveData();

        // Start render loop
        this.loop();
        setInterval(this.loop.bind(this), particleLifetime - shortTime);
    }

    getMode(structName) {
        if (this.renders.has(structName)) return this.renders.get(structName).mode;
        return RenderMode.All; // Default or undefined
    }

    getLayerIndex(structName) {
        if (this.renders.has(structName)) return this.renders.get(structName).layerIndex;
        return 0;
    }

    setMode(mode, structName) {
        if (this.renders.has(structName)) {
            this.renders.get(structName).mode = mode;
            this.refresh(structName);
        }
    }

    setLayerIndex(layerIndex, structName) {
        if (this.renders.has(structName)) {
            this.renders.get(structName).layerIndex = layerIndex;
            this.refresh(structName);
        }
    }

    saveData() {
        const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
        const structObj = {};
        const stored = database.get('structures', {});
        
        for (const [name, item] of this.renders.entries()) {
            const old = stored[name] || {};
            structObj[name] = {
                filePath: old.filePath,
                originPos: old.originPos,
                posLocked: old.posLocked,
                mode: item.mode !== null && item.mode !== undefined ? item.mode : RenderMode.All,
                layerIndex: item.layerIndex !== null && item.layerIndex !== undefined ? item.layerIndex : 0,
            };
        }
        database.set('structures', structObj);
        database.close();
    }

    syncStructures() {
        const structNames = manager.getAllStructureNames();
        
        // Add new
        for (const structName of structNames) {
            if (!this.renders.has(structName)) {
                const originPos = manager.getOriginPos(structName);
                const size = manager.getSize(structName);
                const grids = {};
                for (const color of Object.values(BlockState)) {
                    grids[color] = new FaceGrid(originPos, size, color);
                }

                this.renders.set(structName, {
                    mode: RenderMode.All,
                    layerIndex: 0,
                    particles: [],
                    grids: grids,
                    scanning: false
                });
                // New structure will need a scan, handled by refresh call usually or init
            }
        }

        // Remove old
        for (const structName of this.renders.keys()) {
            if (!structNames.includes(structName)) {
                this.renders.delete(structName);
            }
        }
    }

    refresh(arg1 = null, arg2 = null) {
        if (typeof arg1 === 'string') {
            const structName = arg1;
            if (arg2 && typeof arg2 === 'object' && 'x' in arg2 && 'y' in arg2 && 'z' in arg2) {
                // Single Block Refresh (specified structure)
                this.scanBlock(structName, arg2);
            } else {
                // Structure Refresh
                this.scanStructure(structName);
            }
        } else if (typeof arg1 === 'object' && arg1 !== null) {
            // Single Block Refresh (auto-detect structure)
            // Determine which structure(s) contain this coordinate
            const pos = arg1;
            for (const name of this.renders.keys()) {
                this.scanBlock(name, pos);
            }
        } else {
            // Full Workspace Refresh
            for (const name of this.renders.keys()) {
                this.scanStructure(name);
            }
        }
    }

    async scanBlock(structName, pos) {
        const renderData = this.renders.get(structName);
        if (!renderData || renderData.mode === RenderMode.Off) return;

        const origin = manager.getOriginPos(structName);
        const lx = Math.floor(pos.x - origin.x);
        const ly = Math.floor(pos.y - origin.y);
        const lz = Math.floor(pos.z - origin.z);
        const size = manager.getSize(structName);

        if (lx >= 0 && ly >= 0 && lz >= 0 && lx < size.x && ly < size.y && lz < size.z) {
             // Check if this layer is currently being rendered
             const mode = renderData.mode;
             const layerIndex = renderData.layerIndex;
             
             if (mode === RenderMode.Off) return;
             if (mode === RenderMode.SingleLayer && ly !== layerIndex) return;
             if (mode === RenderMode.BelowLayer && ly > layerIndex) return;
             if (mode === RenderMode.AboveLayer && ly < layerIndex) return;

             const blockPos = new IntPos(origin.x + lx, origin.y + ly, origin.z + lz, origin.dimid);
             
             RenderTool.renderBlock(blockPos, lx, ly, lz, blockData, renderData.grids);
             this.commitParticles(renderData);
        }
    }

    async scanStructure(structName) {
        const renderData = this.renders.get(structName);
        if (!renderData || renderData.scanning) return;
        
        this.interrupt = false;

        if (renderData.mode === RenderMode.Off) {
            renderData.particles = [];
            return;
        }

        renderData.scanning = true;
        let hasUnloadedChunks = false;
        
        if (renderData.mode === RenderMode.All) {
            logger.warn(`开始对原理图: ${structName} 进行全量更新...`);
            mc.broadcast(`§e[ResinClumps] 开始对原理图 §l${structName} §r§e进行全量更新...`, false);
        }

        try {
            // Re-create grids to clear old particles (e.g. from previous layer)
            const originPos = manager.getOriginPos(structName);
            const size = manager.getSize(structName);
            RenderTool.resetCounter();
            
            const grids = {};
            for (const color of Object.values(BlockState)) {
                grids[color] = new FaceGrid(originPos, size, color);
            }
            renderData.grids = grids;

            let result = true;
            switch(renderData.mode) {
                case RenderMode.All:
                    result = await RenderTool.renderAllBlocks(structName, grids);
                    break;
                case RenderMode.SingleLayer:
                    result = await RenderTool.renderLayerBlocks(structName, renderData.layerIndex, grids);
                    break;
                case RenderMode.BelowLayer:
                    result = await RenderTool.renderBelowLayerBlocks(structName, renderData.layerIndex, grids);
                    break;
                case RenderMode.AboveLayer:
                    result = await RenderTool.renderAboveLayerBlocks(structName, renderData.layerIndex, grids);
                    break;
            }
            
            if (result === false) hasUnloadedChunks = true;

            this.commitParticles(renderData);

            if (renderData.mode === RenderMode.All) {
                logger.info(`原理图: ${structName} 全量更新完成! 粒子数: ${this.getParticleCount(structName)}`);
                // mc.broadcast(`[ResinClumps] 原理图 §l${structName} §r全量更新完成! 粒子数: §l${this.getParticleCount(structName)}`);
            }

        } finally {
            renderData.scanning = false;
            // Retry if incomplete
            if (hasUnloadedChunks) {
                setTimeout(() => this.scanStructure(structName), retryInterval);
            }
        }
    }

    commitParticles(renderData) {
        const newParticles = [];
        for (const grid of Object.values(renderData.grids)) {
            grid.greedy(); // Process greedy mesh
            const parts = grid.getParticles();
            for(const p of parts) newParticles.push(p);
        }
        renderData.particles = newParticles;
    }

    async loop() {
        let spawnedCount = 0;

        for (const renderData of this.renders.values()) {
            if (renderData.mode === RenderMode.Off) continue;
            
            for (const p of renderData.particles) {
                this.ps.spawnParticle(p.pos, p.identifier);
                
                spawnedCount++;
                if (spawnedCount >= renderSpeed) {
                    spawnedCount = 0;
                    await new Promise(resolve => setTimeout(resolve, displayInterval));
                }
            }
        }
    }

    getMaterials(structName, player, mode = null) {
        if (!manager.hasStructure(structName)) return;

        // logger.info(`玩家 ${player.name} 请求获取原理图 ${structName} 的材料列表`);
        this.getMaterialsAsync(structName, player, mode);
    }
    
    async getMaterialsAsync(structName, player, mode = null) {
        const renderData = this.renders.get(structName);
        if (!renderData) return;

        mode = mode !== null ? mode : renderData.mode;
        const layerIndex = renderData.layerIndex;
        const size = manager.getSize(structName);
        const originPos = manager.getOriginPos(structName);

        let yMin = 0, yMax = size.y;
        if (mode === RenderMode.SingleLayer) {
            yMin = layerIndex; yMax = layerIndex + 1;
        } else if (mode === RenderMode.BelowLayer) {
            yMax = layerIndex + 1;
        } else if (mode === RenderMode.AboveLayer) {
            yMin = layerIndex;
        } else if (mode === RenderMode.Off) {
            yMax = 0;
        }
        
        yMin = Math.max(0, yMin);
        yMax = Math.min(size.y, yMax);
        RenderTool.resetCounter();

        const pendingBlocks = new Map();
        let totalBlocksInView = 0;
        
        // Notify player
        const progressTimer = setInterval(() => {
            player.sendText(`正在获取材料列表 §l${structName}`, 5);
        }, 1000);

        for (let y = yMin; y < yMax; y++) {
            for (let x = 0; x < size.x; x++) {
                for (let z = 0; z < size.z; z++) {
                     await RenderTool.checkYield();
                     const { blockData } = manager.getBlockData(structName, { x, y, z });
                     if (blacklist.includes(blockData.name)) continue;
                     
                     const name = blockData.name;
                     if (name === "minecraft:air") continue;
                     if (!name.includes('flowing_')) totalBlocksInView++;

                     const need = await RenderTool.checkBlockNeeding(
                         originPos.x + x, originPos.y + y, originPos.z + z, originPos.dimid, name
                     );
                     
                    if (need) {
                        // 先走一轮方块名字预处理
                        const name1 = HelperUtils.simplifyBlockName(name);
                        pendingBlocks.set(name1, (pendingBlocks.get(name1) || 0) + 1);
                    }
                }
            }
        }

        clearInterval(progressTimer);
        const results = Array.from(pendingBlocks.entries()).map(([blockName, count]) => ({ blockName, count }));
        setTimeout(() => { Event.trigger(Events.GUI_SEND_MATERIALS, player, structName, results, totalBlocksInView); }, 1);
    }
    getParticleCount(structName) {
        if (!this.renders.has(structName)) return 0;
        return this.renders.get(structName).particles.length;
    }
}

class RenderTool {
    static processedCount = 0;

    static resetCounter() {
        RenderTool.processedCount = 0;
    }

    static async checkYield() {
        RenderTool.processedCount++;
        if (RenderTool.processedCount >= scanSpeed) {
            RenderTool.processedCount = 0;
            await new Promise(resolve => setTimeout(resolve, displayInterval));
        }
    }

    static async renderAllBlocks(structName, grids) {
        if (!manager.hasStructure(structName)) return true;
        RenderTool.startTime = Date.now();
        const size = manager.getSize(structName);
        let success = true;
        for (let y = 0; y < size.y; y++) {
            if (Render.interrupt) return success;
            if (!await RenderTool.renderPlane(structName, y, grids)) success = false;
        }
        return success;
    }

    static async renderPlane(structName, sy, grids) {
        const size = manager.getSize(structName);
        if (!size) return true;
        
        const originPos = manager.getOriginPos(structName);
        const start = sy * size.x * size.z;
        let success = true;
        
        // To avoid excessive helper calls, iterating directly
        for (let sx = 0; sx < size.x; sx++) {
             for (let sz = 0; sz < size.z; sz++) {
                 await RenderTool.checkYield();
                 const i = start + sx * size.z + sz;
                 const { blockData } = manager.getBlockData(structName, i);
                 const pos = new IntPos(originPos.x + sx, originPos.y + sy, originPos.z + sz, originPos.dimid);
                 if (!RenderTool.renderBlock(pos, sx, sy, sz, blockData, grids)) success = false;
             }
        }
        return success;
    }

    static async renderLayerBlocks(structName, layerIndex, grids) {
        const size = manager.getSize(structName);
        if (layerIndex >= 0 && layerIndex < size.y) {
            RenderTool.startTime = Date.now();
            return await RenderTool.renderPlane(structName, layerIndex, grids);
        }
        return true;
    }

    static async renderBelowLayerBlocks(structName, layerIndex, grids) {
        RenderTool.startTime = Date.now();
        let success = true;
        for (let y = 0; y <= layerIndex; y++) {
             if (Render.interrupt) return success;
             if (!await RenderTool.renderPlane(structName, y, grids)) success = false;
        }
        return success;
    }

    static async renderAboveLayerBlocks(structName, layerIndex, grids) {
        const size = manager.getSize(structName);
        RenderTool.startTime = Date.now();
        let success = true;
        for (let y = layerIndex; y < size.y; y++) {
            if (Render.interrupt) return success;
            if (!await RenderTool.renderPlane(structName, y, grids)) success = false;
        }
        return success;
    }

    static renderBlock(pos, x, y, z, expected, grids) {
        const block = mc.getBlock(pos);
        if (!block) return false;
        
        const expectedName = expected.name;
        let errorState = null;

        if (block.type === 'minecraft:air' && expectedName !== 'minecraft:air') errorState = BlockState.Lost;
        else if (expectedName === 'minecraft:air' && block.type !== 'minecraft:air') errorState = BlockState.Extra;
        else if (block.type !== expectedName) errorState = BlockState.WrongType;
        else if (!HelperUtils.ObjectEquals(block.getBlockState(), HelperUtils.trueToOne(expected.states))) errorState = BlockState.WrongState;

        for (const [state, grid] of Object.entries(grids)) {
            if (state === errorState) grid.setTrue(x, y, z);
            else grid.setFalse(x, y, z);
        }
        return true;
    }

    static checkNeedLogic(actualType, expectedName) {
        if (actualType === 'minecraft:bubble_column') actualType = 'minecraft:water';
        if (actualType.includes('flowing_')) return false;
        return actualType !== expectedName;
    }

    static checkBlockNeeding(bx, by, bz, dimid, expectedName) {
        return new Promise(resolve => {
            const block = mc.getBlock(bx, by, bz, dimid);
            if (block) return resolve(RenderTool.checkNeedLogic(block.type, expectedName));
            
            const interval = setInterval(() => {
                const b = mc.getBlock(bx, by, bz, dimid);
                if (b) {
                    clearInterval(interval);
                    resolve(RenderTool.checkNeedLogic(b.type, expectedName));
                }
            }, 50);
        });
    }
}

class FaceGrid {
    constructor(startPos, size, color) {
        this.needGreedys = new Set(); // Stores "face,layer" strings
        this.color = color;
        this.particlesDirty = false;
        this.particles = [];
        this.pos = startPos;
        this.sizeX = size.x; this.sizeY = size.y; this.sizeZ = size.z;
        
        // Flattened 3D Grid: sizeX * sizeY * sizeZ
        // Layout: x outer, y mid, z inner -> index = x * (sizeY * sizeZ) + y * sizeZ + z
        this.grid = new Uint8Array(this.sizeX * this.sizeY * this.sizeZ);
        
        // 6 Directions Faces (Flattened)
        // 0(xp), 1(xn): layer=x. Dim(z, y). Index = x*(Z*Y) + z*Y + y
        // 2(yp), 3(yn): layer=y. Dim(x, z). Index = y*(X*Z) + x*Z + z
        // 4(zp), 5(zn): layer=z. Dim(x, y). Index = z*(X*Y) + x*Y + y
        this.Faces = [
            new Uint8Array(this.sizeX * this.sizeZ * this.sizeY), // xp
            new Uint8Array(this.sizeX * this.sizeZ * this.sizeY), // xn
            new Uint8Array(this.sizeY * this.sizeX * this.sizeZ), // yp
            new Uint8Array(this.sizeY * this.sizeX * this.sizeZ), // yn
            new Uint8Array(this.sizeZ * this.sizeX * this.sizeY), // zp
            new Uint8Array(this.sizeZ * this.sizeX * this.sizeY)  // zn
        ];
        
        this.facesGreedy = new Map(); 
    }

    updatePos(newPos) {
        if (this.pos.x !== newPos.x || this.pos.y !== newPos.y || this.pos.z !== newPos.z || this.pos.dimid !== newPos.dimid) {
            this.pos = newPos;
            this.particlesDirty = true;
        }
    }

    // Helper to access flattened grid
    _g(x, y, z) {
        return this.grid[x * this.sizeY * this.sizeZ + y * this.sizeZ + z];
    }
    _sg(x, y, z, val) {
        this.grid[x * this.sizeY * this.sizeZ + y * this.sizeZ + z] = val;
    }

    // Helpers to access flattened faces
    _sf(face, layer, u, v, val) {
        let idx = 0;
        if (face < 2) idx = layer * this.sizeZ * this.sizeY + u * this.sizeY + v; // u=z, v=y
        else if (face < 4) idx = layer * this.sizeX * this.sizeZ + u * this.sizeZ + v; // u=x, v=z
        else idx = layer * this.sizeX * this.sizeY + u * this.sizeY + v; // u=x, v=y
        
        this.Faces[face][idx] = val;
    }

    setTrue(x, y, z) {
        const idx = x * this.sizeY * this.sizeZ + y * this.sizeZ + z;
        if (this.grid[idx]) return;
        this.grid[idx] = 1;

        if (this.color === BlockState.Lost) {
            // Blue (Lost): Render all faces independently
            // 0,1(x): layer=x, u=z, v=y
            this._sf(0, x, z, y, 1); this._sf(1, x, z, y, 1);
            // 2,3(y): layer=y, u=x, v=z
            this._sf(2, y, x, z, 1); this._sf(3, y, x, z, 1);
            // 4,5(z): layer=z, u=x, v=y
            this._sf(4, z, x, y, 1); this._sf(5, z, x, y, 1);
            this.addDirty(x, y, z);
        } else {
            // Cull logic
            const xp = (x >= this.sizeX - 1) || !this._g(x+1, y, z);
            const xn = (x <= 0)              || !this._g(x-1, y, z);
            const yp = (y >= this.sizeY - 1) || !this._g(x, y+1, z);
            const yn = (y <= 0)              || !this._g(x, y-1, z);
            const zp = (z >= this.sizeZ - 1) || !this._g(x, y, z+1);
            const zn = (z <= 0)              || !this._g(x, y, z-1);

            this._sf(0, x, z, y, xp ? 1 : 0); this._sf(1, x, z, y, xn ? 1 : 0);
            this._sf(2, y, x, z, yp ? 1 : 0); this._sf(3, y, x, z, yn ? 1 : 0);
            this._sf(4, z, x, y, zp ? 1 : 0); this._sf(5, z, x, y, zn ? 1 : 0);
            this.addDirty(x, y, z);

            // Update neighbors
            if (x < this.sizeX - 1 && this._g(x+1, y, z)) { this._sf(1, x+1, z, y, 0); this.addDirty(x+1, y, z); }
            if (x > 0              && this._g(x-1, y, z)) { this._sf(0, x-1, z, y, 0); this.addDirty(x-1, y, z); }
            
            if (y < this.sizeY - 1 && this._g(x, y+1, z)) { this._sf(3, y+1, x, z, 0); this.addDirty(x, y+1, z); }
            if (y > 0              && this._g(x, y-1, z)) { this._sf(2, y-1, x, z, 0); this.addDirty(x, y-1, z); }
            
            if (z < this.sizeZ - 1 && this._g(x, y, z+1)) { this._sf(5, z+1, x, y, 0); this.addDirty(x, y, z+1); }
            if (z > 0              && this._g(x, y, z-1)) { this._sf(4, z-1, x, y, 0); this.addDirty(x, y, z-1); }
        }
    }
    
    setFalse(x, y, z) {
        const idx = x * this.sizeY * this.sizeZ + y * this.sizeZ + z;
        if (!this.grid[idx]) return;
        this.grid[idx] = 0;

        this._sf(0, x, z, y, 0); this._sf(1, x, z, y, 0);
        this._sf(2, y, x, z, 0); this._sf(3, y, x, z, 0);
        this._sf(4, z, x, y, 0); this._sf(5, z, x, y, 0);
        this.addDirty(x, y, z);

        if (this.color !== BlockState.Lost) {
            if (x < this.sizeX - 1 && this._g(x+1, y, z)) { this._sf(1, x+1, z, y, 1); this.addDirty(x+1, y, z); }
            if (x > 0              && this._g(x-1, y, z)) { this._sf(0, x-1, z, y, 1); this.addDirty(x-1, y, z); }
            
            if (y < this.sizeY - 1 && this._g(x, y+1, z)) { this._sf(3, y+1, x, z, 1); this.addDirty(x, y+1, z); }
            if (y > 0              && this._g(x, y-1, z)) { this._sf(2, y-1, x, z, 1); this.addDirty(x, y-1, z); }
            
            if (z < this.sizeZ - 1 && this._g(x, y, z+1)) { this._sf(5, z+1, x, y, 1); this.addDirty(x, y, z+1); }
            if (z > 0              && this._g(x, y, z-1)) { this._sf(4, z-1, x, y, 1); this.addDirty(x, y, z-1); }
        }
    }

    addDirty(x, y, z) {
        this.needGreedys.add(`0,${x}`); this.needGreedys.add(`1,${x}`);
        this.needGreedys.add(`2,${y}`); this.needGreedys.add(`3,${y}`);
        this.needGreedys.add(`4,${z}`); this.needGreedys.add(`5,${z}`);
    }

    greedy() {
        if (this.needGreedys.size === 0) return;
        this.particlesDirty = true;
        for (const item of this.needGreedys) {
            const [face, layer] = item.split(',').map(Number);
            this.meshFace(face, layer);
        }
        this.needGreedys.clear();
    }

    meshFace(faceStr, layer) {
        const face = Number(faceStr);
        let width, height;
        let startIndex = 0;

        // Determine dims and start index based on face
        if (face < 2) { // x
            width = this.sizeZ; height = this.sizeY;
            startIndex = layer * width * height; 
        } else if (face < 4) { // y
            width = this.sizeX; height = this.sizeZ; 
            startIndex = layer * width * height;
        } else { // z
            width = this.sizeX; height = this.sizeY;
            startIndex = layer * width * height;
        }

        const faceArr = this.Faces[face];
        // Flattened visited array instead of 2D
        const visited = new Uint8Array(width * height);
        
        // Clear old results for this face/layer
        const prefix = `${face},${layer}`;
        for (const key of this.facesGreedy.keys()) {
           if (key.startsWith(prefix)) this.facesGreedy.delete(key);
        }

        for (let w = 0; w < width; w++) {
            let h = 0;
            while (h < height) {
                // Access flattened arrays
                const cellIdx = startIndex + w * height + h;
                const visIdx = w * height + h;

                if (visited[visIdx] || !faceArr[cellIdx]) { h++; continue; }
                
                let maxHeight = 1;
                for (let y = 1; y < Math.min(12, height - h); y++) { 
                     // Check next in column: w same, h increasing
                     if (!faceArr[startIndex + w * height + (h + y)]) break;
                     maxHeight = y + 1;
                }
                
                let maxWidth = 1;
                for (let x = 1; x < Math.min(12, width - w); x++) {
                    let valid = true;
                    for (let y = h; y < h + maxHeight; y++) {
                        // Check next columns
                         if (!faceArr[startIndex + (w + x) * height + y]) { valid = false; break; }
                    }
                    if (!valid) break;
                    maxWidth = x + 1;
                }
                
                // Mark visited
                for(let x = w; x < w+maxWidth; x++) {
                    for(let y = h; y < h+maxHeight; y++) {
                        visited[x * height + y] = 1;
                    }
                }
                
                this.facesGreedy.set(`${face},${layer},${w},${h}`, { w: maxWidth, h: maxHeight });
                h += maxHeight; 
            }
        }
    }

    getParticles() {
        if (!this.particlesDirty) return this.particles;
        this.particlesDirty = false;
        
        this.particles = [];
        const isB = this.color === BlockState.Lost;
        const val = isB ? 1.0/32.0 : -1.0/32.0;
        const offsetP = 1.0 - val;
        const offsetN = val;
        
        for (const [key, size] of this.facesGreedy) {
            const [face, layer, i, j] = key.split(',').map(Number);
            let x, y, z;
            
            if (face === 0) { // +X
                x = this.pos.x + layer + offsetP;
                z = this.pos.z + i + size.w / 2.0;
                y = this.pos.y + j + size.h / 2.0;
            } else if (face === 1) { // -X
                x = this.pos.x + layer + offsetN;
                z = this.pos.z + i + size.w / 2.0;
                y = this.pos.y + j + size.h / 2.0;
            } else if (face === 2) { // +Y
                y = this.pos.y + layer + offsetP;
                x = this.pos.x + i + size.w / 2.0;
                z = this.pos.z + j + size.h / 2.0;
            } else if (face === 3) { // -Y
                y = this.pos.y + layer + offsetN;
                x = this.pos.x + i + size.w / 2.0;
                z = this.pos.z + j + size.h / 2.0;
            } else if (face === 4) { // +Z
                z = this.pos.z + layer + offsetP;
                x = this.pos.x + i + size.w / 2.0;
                y = this.pos.y + j + size.h / 2.0;
            } else { // -Z
                z = this.pos.z + layer + offsetN;
                x = this.pos.x + i + size.w / 2.0;
                y = this.pos.y + j + size.h / 2.0;
            }
            
            const identifier = `face_${Math.floor(face / 2)}_${size.w}X${size.h}_${this.color}`;
            this.particles.push({ pos: new FloatPos(x, y, z, this.pos.dimid), identifier });
        }
        return this.particles;
    }
}


export class RenderMode {
    static All = 0;
    static SingleLayer = 1;
    static BelowLayer = 2;
    static AboveLayer = 3;
    static Off = 4;
    static modes_zh = ["全部", "单层", "此层之下", "此层之上", "关闭"];
}

const BlockState = {
    Lost: 'b',
    WrongType: 'r',
    WrongState: 'rg',
    Extra: 'rb'
};

export const Render = new RenderMgr();

export function RenderInit() {
  if (typeof Event === 'undefined') throw new Error("Event module is required.");
  Render.init();
  
}
