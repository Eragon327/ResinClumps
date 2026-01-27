import { Event, Events } from "../core/event.js";
import { manager } from "../core/manager.js";
import { HelperUtils } from "../utils/helpers.js";

const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json");
const displayInterval = configFile.get("displayInterval", 50);
const displayRadius = configFile.get("displayRadius", 70);
const particleLifetime = configFile.get("particleLifetime", 1550);
const blacklist = configFile.get('BlackList', []);
configFile.close();

class RenderMgr {
  constructor() {
    this.renders = new Map(); // structName -> { mode, layerIndex, particles: [], scanToken: 0 }
    this.interrupt = false; // 用于强制打断所有渲染任务
  }

  init() {
    Event.listen(Events.RENDER_SET_RENDER_MODE, this.#setMode.bind(this));
    Event.listen(Events.RENDER_SET_LAYER_INDEX, this.#setLayerIndex.bind(this));
    Event.listen(Events.RENDER_UPDATE_DATA, this.#updateData.bind(this));
    Event.listen(Events.MANAGER_REMOVE_STRUCTURE, this.#updateWithManager.bind(this));
    Event.listen(Events.MANAGER_ADD_STRUCTURE, this.#updateWithManager.bind(this));
    Event.listen(Events.RENDER_GET_MATERIALS, this.#getMaterials.bind(this));
    Event.listen(Events.RENDER_STOP_ALL_RENDERING, () => { this.interrupt = true; });
    Event.listen(Events.RENDER_REFRESH_GRIDS, this.refreshGrids.bind(this));
    
    this.#updateWithManager();

    const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json");
    for (const [name, item] of Object.entries(database.get('structures', {}))) {
      if (!this.renders.has(name)) continue;
      const renderData = this.renders.get(name);
      
      const size = manager.getSize(name);
      if (!size) continue;
      const max = size.y - 1;
      
      if (item.layerIndex < 0) {
          renderData.mode = RenderMode.Off;
          renderData.layerIndex = 0;
      } else if (item.layerIndex < max) {
          renderData.mode = item.mode;
          renderData.layerIndex = item.layerIndex;
      } else {
          renderData.mode = RenderMode.Off;
          renderData.layerIndex = max;
      }
    }
    database.close();

    this.#updateData();
  }

  getMode(structName) {
    if (this.renders.has(structName)) return this.renders.get(structName).mode;
  }

  getLayerIndex(structName) {
    if (this.renders.has(structName)) return this.renders.get(structName).layerIndex;
  }
  
  #setMode(mode, structName) { // mode 前置符合原使用习惯
    if (this.renders.has(structName)) this.renders.get(structName).mode = mode;
    // this.#updateData();  // 自行调用
  }

  #setLayerIndex(layerIndex, structName) { // layerIndex 前置符合原使用习惯
    if (this.renders.has(structName)) this.renders.get(structName).layerIndex = layerIndex;
    // this.#updateData();  // 自行调用
  }

  #updateWithManager() {
    const structNames = manager.getAllStructureNames();
    for (const structName of structNames) {
      if (!this.renders.has(structName)) {
        const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
        const structObj = database.get('structures', {})[structName] || {};
        database.close();

        const mode = structObj?.mode || RenderMode.All;
        const layerIndex = structObj?.layerIndex || 0;
        
        // Initialize Persistent Grids
        const originPos = manager.getOriginPos(structName);
        const size = manager.getSize(structName);
        const grids = {};
        for (const [state, color] of Object.entries(StateToGridColor)) {
            grids[state] = new FaceGrid(originPos, size, color);
        }

        this.renders.set(structName, { 
            mode: mode,
            layerIndex: layerIndex, 
            particles: [], 
            grids: grids,
            updateTask: null 
        });
        
        // Initial scan
        this.refreshGrids(structName);
      }
    }
    for (const structName of this.renders.keys()) {
      if (!structNames.includes(structName)) {
        this.renders.delete(structName);  // Manager 数据为标准, 只有它保存了结构数据
      }
    }
    // this.#updateData();
  }

  #updateData() {
    const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
    const structObj = {};
    for (const [name, item] of this.renders.entries()) {
      const old = database.get('structures', {})[name] || {};
      structObj[name] = {
        filePath: old.filePath,
        originPos: old.originPos,
        posLocked: old.posLocked,
        mode: item.mode,
        layerIndex: item.layerIndex,
      };
    }
    database.set('structures', structObj);
    database.close();
  }

  // refreshGrids with support for partial update
  // args: (structName, posOrReset) OR (posOrReset)
  // posOrReset: using boolean true means forceReset (compatibility), using Object means Position {x,y,z}
  refreshGrids(arg1 = null, arg2 = null) {
      let structName = null;
      let pos = null;
      let forceReset = false;

      // Argument parsing
      if (typeof arg1 === 'string') {
          structName = arg1;
          if (typeof arg2 === 'boolean') forceReset = arg2;
          else if (typeof arg2 === 'object') pos = arg2;
      } else if (typeof arg1 === 'object' && arg1 !== null) {
          pos = arg1;
      } else if (typeof arg1 === 'boolean') {
          forceReset = arg1;
      }
      
      // Force reset (recreate grids) if doing a full scan, to ensure no artifacts from previous modes/positions
      if (pos === null) forceReset = true;

      if (structName) {
         if (this.renders.has(structName)) {
             this.#scheduleUpdate(structName, pos, forceReset);
         }
      } else {
         for (const name of this.renders.keys()) {
             // If pos is provided, we check if this structure contains the pos
             if (pos) {
                 const origin = manager.getOriginPos(name);
                 const size = manager.getSize(name);
                 if (origin && size) {
                     const lx = pos.x - origin.x;
                     const ly = pos.y - origin.y;
                     const lz = pos.z - origin.z;
                     if (lx >= 0 && lx < size.x && ly >= 0 && ly < size.y && lz >= 0 && lz < size.z) {
                         this.#scheduleUpdate(name, pos, false);
                     }
                 }
             } else {
                 this.#scheduleUpdate(name, null, forceReset);
             }
         }
      }
  }

  // Schedule an update task. If one exists, merge or override it.
  #scheduleUpdate(structName, pos, forceReset) {
      const renderData = this.renders.get(structName);
      if (!renderData) return;
      if (renderData.mode === RenderMode.Off) return;

      if (forceReset) {
          // Recreate grids to ensure clean state
          const originPos = manager.getOriginPos(structName);
          const size = manager.getSize(structName);
          for (const [state, color] of Object.entries(StateToGridColor)) {
            renderData.grids[state] = new FaceGrid(originPos, size, color);
          }
      }

      // If we have a pending full scan, we don't need to add a partial scan.
      // If we have pending partial scans, we can add this one.
      // If we are transforming from partial to full, we overwrite.
      
      const currentTask = renderData.updateTask;
      
      if (pos === null) {
          // Full scan requested
          renderData.updateTask = { type: 'full' };
      } else {
          // Partial scan requested
          if (!currentTask || currentTask.type === 'partial') {
              const task = currentTask || { type: 'partial', positions: [] };
              // Simple dedupe or just push. Pushing is cheap.
              task.positions.push(pos);
              renderData.updateTask = task;
          }
          // If type is 'full', we ignore partial request as full scan covers it.
      }

      // Trigger processing if not running
      this.#processUpdates(structName);
  }

  async #processUpdates(structName) {
      const renderData = this.renders.get(structName);
      if (!renderData || !renderData.updateTask || renderData.processing) return;

      renderData.processing = true;

      try {
          // Take the task
          const task = renderData.updateTask;
          renderData.updateTask = null; // Clear so new tasks can queue
          
          if (task.type === 'full') {
              await this.#performFullScan(structName, renderData);
          } else if (task.type === 'partial') {
              await this.#performPartialScan(structName, renderData, task.positions);
          }
          
      } catch(e) {
          logger.error(`Error updating structure ${structName}: ${e}`);
      } finally {
          renderData.processing = false;
          // If new tasks arrived while processing, process them
          if (renderData.updateTask) {
              this.#processUpdates(structName);
          }
      }
  }

  async #performFullScan(structName, renderData) {
      const grids = renderData.grids;
      // Update origin pos for grids just in case
      const originPos = manager.getOriginPos(structName);
      if (originPos) {
        for (const grid of Object.values(grids)) grid.updatePos(originPos);
      }
      
      // Full Scan
      switch (renderData.mode) {
        case RenderMode.All:
          await RenderTool.renderAllBlocks(structName, grids);
          break;
        case RenderMode.SingleLayer:
          await RenderTool.renderLayerBlocks(structName, renderData.layerIndex, grids);
          break;
        case RenderMode.BelowLayer:
          await RenderTool.renderBelowLayerBlocks(structName, renderData.layerIndex, grids);
          break;
        case RenderMode.AboveLayer:
          await RenderTool.renderAboveLayerBlocks(structName, renderData.layerIndex, grids);
          break;
      }
      
      this.#commitParticles(renderData);
  }

  async #performPartialScan(structName, renderData, positions) {
      const grids = renderData.grids;
      const originPos = manager.getOriginPos(structName);
      const size = manager.getSize(structName);
      if (!originPos || !size) return;

      // Update pos just in case
      for (const grid of Object.values(grids)) grid.updatePos(originPos);

      // Process positions
      // We can batch them.
      // And we should consider using yield if too many? Partial usually small.
      
      const seen = new Set();
      
      for (const pos of positions) {
          const lx = Math.floor(pos.x - originPos.x);
          const ly = Math.floor(pos.y - originPos.y);
          const lz = Math.floor(pos.z - originPos.z);
          
          if (lx < 0 || ly < 0 || lz < 0 || lx >= size.x || ly >= size.y || lz >= size.z) continue;
          
          const key = `${lx},${ly},${lz}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const { blockData } = manager.getBlockData(structName, { x: lx, y: ly, z: lz });
          const blockPos = new IntPos(originPos.x + lx, originPos.y + ly, originPos.z + lz, originPos.dimid);
          const localPos = { x: lx, y: ly, z: lz };

          // Check block
          RenderTool.renderBlock(blockPos, localPos, blockData, grids);
      }
      
      this.#commitParticles(renderData);
  }

  #commitParticles(renderData) {
      const newParticles = [];
      const grids = renderData.grids;
      for (const grid of Object.values(grids)) {
          grid.greedy();
          const particles = grid.getParticles();
          for (const p of particles) {
            newParticles.push(p);
          }
      }
      // Atomic Update
      renderData.particles = newParticles;
  }

  async loop() {
    // 渲染循环: 只负责从缓存发射粒子，不负责扫描
    const start = Date.now();
    let hasActive = false;

    for (const renderData of this.renders.values()) {
        if (renderData.mode === RenderMode.Off) continue;
        hasActive = true;
        if (renderData.particles) {
            for (const p of renderData.particles) {
               ps.spawnParticle(p.pos, p.identifier);
            }
        }
    }

    if (!hasActive) {
        setTimeout(this.loop.bind(this), 1000);
        return;
    }

    const end = Date.now();
    const elapsed = end - start;

    let delay = particleLifetime - elapsed;
    if (delay < 50) delay = 50; 

    setTimeout(this.loop.bind(this), delay);
  }

  async render() {
     // Deprecated. loop() is used instead.
  }
  
  async #getMaterials(structName, player) {
    if (!manager.hasStructure(structName)) {
      Event.trigger(Events.GUI_SEND_MATERIALS, player, [], 0);
      return;
    }

    const mode = this.getMode(structName);
    const layerIndex = this.getLayerIndex(structName);
    const pendingBlocks = new Map(); // blockName -> count
    
    const originPos = manager.getOriginPos(structName);
    const size = manager.getSize(structName);
    
    // Determine Y range based on render mode
    let yMin = 0;
    let yMax = size.y;

    switch(mode) {
      case RenderMode.SingleLayer:
        yMin = layerIndex;
        yMax = layerIndex + 1;
        break;
      case RenderMode.BelowLayer:
        yMax = layerIndex + 1;
        break;
      case RenderMode.AboveLayer:
        yMin = layerIndex;
        break;
      case RenderMode.Off:
        yMax = 0; // Skip
        break;
    }

    // Clamp values
    yMin = Math.max(0, yMin);
    yMax = Math.min(size.y, yMax);
    
    const progressInterval = setInterval(() => {
      player.sendText(`正在获取材料列表 §l${structName}`, 5);
    }, 1000);
  
    let totalBlocksInView = 0;

    for (let y = yMin; y < yMax; y++) {
      for (let x = 0; x < size.x; x++) {
        for (let z = 0; z < size.z; z++) {
          const { blockData } = manager.getBlockData(structName, { x, y, z });

          if (blacklist.includes(blockData.name)) continue;
          
          const targetName = blockData.name;
          
          // 跳过空气
          if (targetName === "minecraft:air") {
            continue;
          }

          if (!targetName.includes('flowing_')) {
            totalBlocksInView++;
          }

          const needFix = await RenderMgr.#needOneBlock(
            originPos.x + x,
            originPos.y + y,
            originPos.z + z,
            originPos.dimid,
            targetName
          );
          
          if (needFix) {
            pendingBlocks.set(targetName, (pendingBlocks.get(targetName) || 0) + 1);
          }
        }
      }
    }
  
    clearInterval(progressInterval);
  
    // 转换为结果数组
    const results = Array.from(pendingBlocks.entries()).map(([blockName, count]) => ({ blockName, count }));
    
    Event.trigger(Events.GUI_SEND_MATERIALS, player, results, totalBlocksInView);
  }
  
  // 核心优化：同步优先 + 无限重试
  static #needOneBlock(bx, by, bz, dimid, expectedName) {
    return new Promise(resolve => {
      // 优先同步尝试
      const block = mc.getBlock(bx, by, bz, dimid);
      if (block) {
        // 同步resolve, await立即继续
        return resolve(RenderMgr.#checkNeed(block.type, expectedName));
      }
      
      // 每 50 ms 尝试获取方块状态，直到成功
      const interval = setInterval(() => {
        const block = mc.getBlock(bx, by, bz, dimid);
        if (block) {
          clearInterval(interval);
          resolve(RenderMgr.#checkNeed(block.type, expectedName));
        }
      }, 50);
    });
  }
  
  // 静态工具: 判断是否需要
  static #checkNeed(actualType, expectedName) {
    // 气泡柱视为水
    if (actualType === 'minecraft:bubble_column') actualType = 'minecraft:water';
    
    // 流动液体不计入材料
    if (actualType.includes('flowing_')) return false;
    
    // 此处做了多功能, 可读性稍差
    return actualType !== expectedName;
  }

}
const ps = new ParticleSpawner(displayRadius, false, false);

class Particle{
  static drawCuboid(pos, color) {
    ps.spawnParticle(pos, `${color}_x0`);
    ps.spawnParticle(pos, `${color}_x1`);
    ps.spawnParticle(pos, `${color}_y0`);
    ps.spawnParticle(pos, `${color}_y1`);
    ps.spawnParticle(pos, `${color}_z0`);
    ps.spawnParticle(pos, `${color}_z1`);
  }
}

class BlockState {
  static Lost       = 'Particle_Blue';
  static WrongType  = 'Particle_Red';
  static WrongState = 'Particle_Yellow';
  static Extra      = 'Particle_Pink';
}

const GridColor = {
  r: 'r',
  g: 'g',
  b: 'b',
  rg: 'rg',
  rb: 'rb'
};

const StateToGridColor = {
  [BlockState.Lost]: GridColor.b,
  [BlockState.WrongType]: GridColor.r,
  [BlockState.WrongState]: GridColor.rg,
  [BlockState.Extra]: GridColor.rb
};

class RenderTool {
  static renderBlock(pos, localPos, expected, grids) {
    const block = mc.getBlock(pos);
    if (!block) return false;
    
    const blockType = expected.name;
    let errorState = null;

    if (block.type === 'minecraft:air' && blockType !== 'minecraft:air') {
      errorState = BlockState.Lost;
    }
    else if (blockType === 'minecraft:air' && block.type !== 'minecraft:air') {
      errorState = BlockState.Extra;
    }
    else if (block.type !== blockType) {
      errorState = BlockState.WrongType;
    }
    else if (!HelperUtils.ObjectEquals(block.getBlockState(), HelperUtils.trueToOne(expected.states))) {
      errorState = BlockState.WrongState;
    }
    
    for (const [state, grid] of Object.entries(grids)) {
        if (state === errorState) {
            grid.setTrue(localPos);
        } else {
            grid.setFalse(localPos);
        }
    }

    return errorState !== null;
  }

  static startTime = 0;
  static MAX_EXECUTION_TIME_MS = 20; // 每一帧最多的处理时间

  static async checkYield() {
    if (Date.now() - RenderTool.startTime > RenderTool.MAX_EXECUTION_TIME_MS) {
      await new Promise(resolve => setTimeout(resolve, 10)); // Yield to main thread
      RenderTool.startTime = Date.now();
    }
  }

  static async renderAllBlocks(structName, grids) {
    if (!manager.hasStructure(structName)) return;
    RenderTool.startTime = Date.now();
    const size = manager.getSize(structName);
    for (let y = 0; y < size.y; y++) {
      if (Render.interrupt) return;
      await RenderTool.renderPlane(structName, y, grids);
    }
  }

  static async renderPlane(structName, sy, grids) {
    const size = manager.getSize(structName);
    if (!size) return;
    
    // Check yield before processing the plane (or inside if plane is huge)
    await RenderTool.checkYield();

    for (let sx = 0; sx < size.x; sx++) {
      RenderTool.renderLine(structName, sx, sy, grids);
    }
  }
        
  static renderLine(structName, sx, sy, grids) {
    const size = manager.getSize(structName);
    const originPos = manager.getOriginPos(structName);
    const start = sy * size.x * size.z + sx * size.z;
    const end = start + size.z;

    let z = 0;
    for (let i = start; i < end; i++) {
      const { blockData } = manager.getBlockData(structName, i);
      const pos = new IntPos(originPos.x + sx, originPos.y + sy, originPos.z + z, originPos.dimid);
      const localPos = { x: sx, y: sy, z: z };
      RenderTool.renderBlock(pos, localPos, blockData, grids);
      z++;
    }
  }

  static async renderLayerBlocks(structName, slayerIndex, grids) {
    const size = manager.getSize(structName);
    if (slayerIndex < 0 || slayerIndex >= size.y) return;
    RenderTool.startTime = Date.now();
    await RenderTool.renderPlane(structName, slayerIndex, grids);
  }

  static async renderBelowLayerBlocks(structName, slayerIndex, grids) {
    RenderTool.startTime = Date.now();
    for (let sy = 0; sy <= slayerIndex; sy++) {
      if (Render.interrupt) return;
      await RenderTool.renderPlane(structName, sy, grids);
    }
  }

  static async renderAboveLayerBlocks(structName, slayerIndex, grids) {
    const size = manager.getSize(structName);
    RenderTool.startTime = Date.now();
    for (let sy = slayerIndex; sy < size.y; sy++) {
      if (Render.interrupt) return;
      await RenderTool.renderPlane(structName, sy, grids);
    }
  }
}

class FaceGrid {
  constructor(startPos, size, color) {
    this.needGreedys = new Set();
    this.color = color;
    this.particlesDirty = false;
    this.particles = [];
    
    this.pos = startPos;
    this.size = size;
    this.sizeX = size.x;
    this.sizeY = size.y;
    this.sizeZ = size.z;
    
    // grid[x][y][z]
    this.grid = Array.from({ length: this.sizeX }, () => 
      Array.from({ length: this.sizeY }, () => 
        new Array(this.sizeZ).fill(false)
      )
    );

    // Faces_xp[x][z][y]
    this.Faces_xp = Array.from({ length: this.sizeX }, () => 
      Array.from({ length: this.sizeZ }, () => new Array(this.sizeY).fill(false))
    );
    this.Faces_xn = Array.from({ length: this.sizeX }, () => 
      Array.from({ length: this.sizeZ }, () => new Array(this.sizeY).fill(false))
    );
    
    // Faces_yp[y][x][z]
    this.Faces_yp = Array.from({ length: this.sizeY }, () => 
      Array.from({ length: this.sizeX }, () => new Array(this.sizeZ).fill(false))
    );
    this.Faces_yn = Array.from({ length: this.sizeY }, () => 
      Array.from({ length: this.sizeX }, () => new Array(this.sizeZ).fill(false))
    );

    // Faces_zp[z][x][y]
    this.Faces_zp = Array.from({ length: this.sizeZ }, () => 
      Array.from({ length: this.sizeX }, () => new Array(this.sizeY).fill(false))
    );
    this.Faces_zn = Array.from({ length: this.sizeZ }, () => 
      Array.from({ length: this.sizeX }, () => new Array(this.sizeY).fill(false))
    );

    this.Faces = [this.Faces_xp, this.Faces_xn, this.Faces_yp, this.Faces_yn, this.Faces_zp, this.Faces_zn];
    
    this.eachDirFacesGreedy = [
      Array.from({ length: this.sizeX }, () => []),
      Array.from({ length: this.sizeX }, () => []),
      Array.from({ length: this.sizeY }, () => []),
      Array.from({ length: this.sizeY }, () => []),
      Array.from({ length: this.sizeZ }, () => []),
      Array.from({ length: this.sizeZ }, () => [])
    ];

    this.facesGreedy = new Map(); // key string "f,l,x,y" -> {w, h}
  }

  updatePos(newPos) {
      if (this.pos.x !== newPos.x || this.pos.y !== newPos.y || this.pos.z !== newPos.z || this.pos.dimid !== newPos.dimid) {
          this.pos = newPos; 
          this.particlesDirty = true;
      }
  }

  setTrue(pos) {
    const x = pos.x, y = pos.y, z = pos.z;
    if (this.grid[x][y][z]) return;
    this.grid[x][y][z] = true;

    this.Faces_xp[x][z][y] = true;
    this.Faces_xn[x][z][y] = true;
    this.Faces_yp[y][x][z] = true;
    this.Faces_yn[y][x][z] = true;
    this.Faces_zp[z][x][y] = true;
    this.Faces_zn[z][x][y] = true;

    this.#addNeedGreedy(0, x);
    this.#addNeedGreedy(1, x);
    this.#addNeedGreedy(2, y);
    this.#addNeedGreedy(3, y);
    this.#addNeedGreedy(4, z);
    this.#addNeedGreedy(5, z);
  }

  setFalse(pos) {
    const x = pos.x, y = pos.y, z = pos.z;
    if (!this.grid[x][y][z]) return;
    this.grid[x][y][z] = false;

    this.Faces_xp[x][z][y] = false;
    this.Faces_xn[x][z][y] = false;
    this.Faces_yp[y][x][z] = false;
    this.Faces_yn[y][x][z] = false;
    this.Faces_zp[z][x][y] = false;
    this.Faces_zn[z][x][y] = false;

    this.#addNeedGreedy(0, x);
    this.#addNeedGreedy(1, x);
    this.#addNeedGreedy(2, y);
    this.#addNeedGreedy(3, y);
    this.#addNeedGreedy(4, z);
    this.#addNeedGreedy(5, z);
  }
  
  #addNeedGreedy(face, layer) {
    this.needGreedys.add(`${face},${layer}`);
  }

  greedyMesh(face, layer) {
    const maxSize = 12;
    const faces = this.Faces[face];
    const faceLayer = faces[layer];
    const width = faceLayer.length;
    const height = faceLayer[0].length;

    // Reset greedy info for this face/layer
    const visited = Array.from({ length: width }, () => new Array(height).fill(false));
    const rectangles = [];

    for (let w = 0; w < width; w++) {
      const visitedLines = visited[w];
      const faceDataLines = faceLayer[w];
      let h = 0;
      while (h < height) {
        if (visitedLines[h] || !faceDataLines[h]) {
          h++;
          continue;
        }

        let maxHeight = 1;
        // 1. Height
        for (let y = 1; y < Math.min(maxSize, height - h); y++) {
          if (!faceDataLines[h + y]) break;
          maxHeight = y + 1;
        }

        let maxWidth = 1;
        // 2. Width
        for (let x = 1; x < Math.min(maxSize, width - w); x++) {
          let validColumn = true;
          const faceDataLinesCurrent = faceLayer[w + x];
          for (let y = h; y < h + maxHeight; y++) {
            if (!faceDataLinesCurrent[y]) {
              validColumn = false;
              break;
            }
          }
          if (!validColumn) break;
          maxWidth = x + 1;
        }

        const xEnd = w + maxWidth;
        const yEnd = h + maxHeight;
        for (let x = w; x < xEnd; x++) {
          const currentVisitedLines = visited[x];
          for (let y = h; y < yEnd; y++) {
            currentVisitedLines[y] = true;
          }
        }

        rectangles.push({ x: w, y: h, w: maxWidth, h: maxHeight });
        h = yEnd;
      }
    }

    // Update greedy dict
    const facesGreedyList = this.eachDirFacesGreedy[face][layer];
    
    // Remove old keys from Map
    for (const key of facesGreedyList) {
      this.facesGreedy.delete(key);
    }
    
    facesGreedyList.length = 0; // clear array
    for (const rect of rectangles) {
      // key: face, layer, x, y
      const key = `${face},${layer},${rect.x},${rect.y}`;
      facesGreedyList.push(key);
      this.facesGreedy.set(key, { w: rect.w, h: rect.h });
    }
  }

  getParticles() {
    if (!this.particlesDirty) return this.particles;
    this.particlesDirty = false;

    const basePos = this.pos; // {x, y, z, dimid}
    this.particles = [];
    const colorValue = this.color;
    // logic from draw.py:
    // offset_p = 1 - (1/32 if self.color == Color.b else -1/32)
    // offset_n = 1/32 if self.color == Color.b else -1/32
    const isB = this.color === GridColor.b;
    const val = isB ? 1.0/32.0 : -1.0/32.0; 
    const offsetP = 1.0 - val;
    const offsetN = val;

    for (const [key, size] of this.facesGreedy) {
      const parts = key.split(',').map(Number);
      const face = parts[0];
      const layer = parts[1];
      const i = parts[2];
      const j = parts[3];
      const width = size.w;
      const height = size.h;

      let x = 0, y = 0, z = 0;

      if (face === 0) { // +X
        x = basePos.x + layer + offsetP;
        z = basePos.z + i + width / 2.0;
        y = basePos.y + j + height / 2.0;
      } else if (face === 1) { // -X
        x = basePos.x + layer + offsetN;
        z = basePos.z + i + width / 2.0;
        y = basePos.y + j + height / 2.0;
      } else if (face === 2) { // +Y
        y = basePos.y + layer + offsetP;
        x = basePos.x + i + width / 2.0;
        z = basePos.z + j + height / 2.0;
      } else if (face === 3) { // -Y
        y = basePos.y + layer + offsetN;
        x = basePos.x + i + width / 2.0;
        z = basePos.z + j + height / 2.0;
      } else if (face === 4) { // +Z
        z = basePos.z + layer + offsetP;
        x = basePos.x + i + width / 2.0;
        y = basePos.y + j + height / 2.0;
      } else { // -Z
        z = basePos.z + layer + offsetN;
        x = basePos.x + i + width / 2.0;
        y = basePos.y + j + height / 2.0;
      }

      const identifier = `face_${Math.floor(face / 2)}_${width}X${height}_${colorValue}`;
      this.particles.push({ pos: new FloatPos(x, y, z, basePos.dimid), identifier });
    }
    return this.particles;
  }

  greedy() {
    if (this.needGreedys.size === 0) return;
    this.particlesDirty = true;
    for (const item of this.needGreedys) {
      const parts = item.split(',').map(Number);
      this.greedyMesh(parts[0], parts[1]);
    }
    this.needGreedys.clear();
  }
}

export class RenderMode {
  static All = 0;
  static SingleLayer = 1;
  static BelowLayer  = 2;
  static AboveLayer = 3;
  static Off = 4;
  static modes_zh = ["全部", "单层", "此层之下", "此层之上", "关闭"];
}

export const Render = new RenderMgr();

export function RenderInit() {
  if (typeof Event === 'undefined') throw new Error("Event module is required for Render module.");
  if (typeof manager === 'undefined') throw new Error("Manager module is required for Render module.");
  if (particleLifetime < 50) throw new Error("unsafe particleLifetime setting in config.json, it should be at least 50ms.");
  
  Render.init();
  Render.loop();
  // logger.info("Render module initialized.");
}