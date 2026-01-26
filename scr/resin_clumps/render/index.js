import { Event, Events } from "../core/event.js";
import { manager } from "../core/manager.js";
import { HelperUtils } from "../utils/helpers.js";

const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json");
const displayInterval = configFile.get("displayInterval", 50);
const displayRadius = configFile.get("displayRadius", 70);
const particleLifetime = configFile.get("particleLifetime", 1550);
const blacklist = configFile.get('BlackList', []);
configFile.close();

let ps; // 延迟初始化

class Particle{
  static drawCuboid(pos, color) {
    if (!ps) return; // 防止未初始化调用
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

class RenderTool {
  static renderBlock(pos, expected) {
    const block = mc.getBlock(pos);
    if (!block) return false;
    const blockType = expected.name;
    if (block.type === 'minecraft:air' && blockType !== 'minecraft:air') {
      Particle.drawCuboid(pos, BlockState.Lost);
      return true;
    }
    else if (blockType === 'minecraft:air' && block.type !== 'minecraft:air') {
      Particle.drawCuboid(pos, BlockState.Extra);
      return true;
    }
    else if (block.type !== blockType) {
      Particle.drawCuboid(pos, BlockState.WrongType);
      return true;
    }
    else if (!HelperUtils.ObjectEquals(HelperUtils.oneToTrue(block.getBlockState()), expected.states)) {
      // logger.info(`Expected states: ${JSON.stringify(expected.states)}, Actual states: ${JSON.stringify(block.getBlockState())}`);
      Particle.drawCuboid(pos, BlockState.WrongState);
      return true;
    }
    return false;
  }

  static async renderAllBlocks(structName) {
    if (!manager.hasStructure(structName)) return;
    const size = manager.getSize(structName);
    for (let y = 0; y < size.y; y++) {
      if (Render.interrupt) return;
      await RenderTool.renderPlane(structName, y);
    }
  }

  static renderPlane(structName, sy) {
    return new Promise((resolve) => {
      const size = manager.getSize(structName);
      if(!size) return resolve();
      let sx = 0;

      const run = () => {
        if (Render.interrupt) {
          resolve();
          return;
        }
        while (sx < size.x) {
          const success = RenderTool.renderLine(structName, sx, sy);
          sx++;

          if (success) {
            setTimeout(run, displayInterval);
            return;
          }
        }
        resolve();
      };
      run();
    });
  }
        
  static renderLine(structName, sx, sy) {
    let result = false;

    const size = manager.getSize(structName);
    const originPos = manager.getOriginPos(structName);
    const start = sy * size.x * size.z + sx * size.z;
    const end = start + size.z;

    let z = 0;
    for (let i = start; i < end; i++) {
      const { blockData } = manager.getBlockData(structName, i);
      const pos = new IntPos(originPos.x + sx, originPos.y + sy, originPos.z + z, originPos.dimid);
      result = RenderTool.renderBlock(pos, blockData) || result;
      z++;
    }

    return result;
  }

  static renderLayerBlocks(structName, slayerIndex) {
    const size = manager.getSize(structName);
    if (slayerIndex < 0 || slayerIndex >= size.y) return;
    RenderTool.renderPlane(structName, slayerIndex);
  }

  static async renderBelowLayerBlocks(structName, slayerIndex) {
    for (let sy = 0; sy <= slayerIndex; sy++) {
      if (Render.interrupt) return;
      await RenderTool.renderPlane(structName, sy);
    }
  }

  static async renderAboveLayerBlocks(structName, slayerIndex) {
    const size = manager.getSize(structName);
    for (let sy = slayerIndex; sy < size.y; sy++) {
      if (Render.interrupt) return;
      await RenderTool.renderPlane(structName, sy);
    }
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

class RenderMgr {
  constructor() {
    this.mode = RenderMode.All;
    this.layerIndex = 0;
    this.renders = new Map(); // structName -> { mode, layerIndex }
    // this.turnOff = []; // 已弃用该功能
    this.interrupt = false; // 用于强制打断所有渲染任务
  }

  init() {
    Event.listen(Events.RENDER_SET_RENDER_MODE, this.#setMode.bind(this));
    Event.listen(Events.RENDER_SET_LAYER_INDEX, this.#setLayerIndex.bind(this));
    Event.listen(Events.RENDER_UPDATE_DATA, this.#updateData.bind(this));
    Event.listen(Events.MANAGER_REMOVE_STRUCTURE, this.#updateWithManager.bind(this));
    Event.listen(Events.MANAGER_ADD_STRUCTURE, this.#updateWithManager.bind(this));
    Event.listen(Events.RENDER_GET_MATERIALS, this.getMaterials.bind(this));
    Event.listen(Events.RENDER_STOP_ALL_RENDERING, () => { this.interrupt = true; });
    
    this.#updateWithManager();

    const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json");
    for (const [name, item] of Object.entries(database.get('structures', {}))) {
      const max = manager.getSize(name).y - 1;
      if (item.layerIndex < 0) this.renders.set(name, { mode: RenderMode.Off, layerIndex: 0 });
      else if (item.layerIndex < max) this.renders.set(name, { mode: item.mode, layerIndex: item.layerIndex });
      else this.renders.set(name, { mode: RenderMode.Off, layerIndex: max });
    }

    this.mode = database.get('renderMode', RenderMode.All);
    this.layerIndex = database.get('layerIndex', 0);
    database.close();

    this.#updateData();
  }

  getMode(structName = null) {
    if (structName === null) return this.mode;
    else return this.renders.get(structName)?.mode || this.mode;
  }

  getLayerIndex(structName = null) {
    if (structName === null) return this.layerIndex;
    else return this.renders.get(structName)?.layerIndex || this.layerIndex;
  }
  
  #setMode(mode, structName = null) { // mode 前置符合原使用习惯
    if (structName === null) this.mode = mode;
    else this.renders.get(structName).mode = mode;
    // this.#updateData();  // 自行调用
  }

  #setLayerIndex(layerIndex, structName = null) { // layerIndex 前置符合原使用习惯
    if (structName === null) this.layerIndex = layerIndex;
    else this.renders.get(structName).layerIndex = layerIndex;
    // this.#updateData();  // 自行调用
  }

  #updateWithManager() {
    const structNames = manager.getAllStructureNames();
    for (const structName of structNames) {
      if (!this.renders.has(structName)) {
        const ori = manager.getOriginPos(structName).y;
        const max = manager.getSize(structName).y - 1;
        if (this.layerIndex - ori < 0) {
          this.renders.set(structName, { mode: RenderMode.Off, layerIndex: 0 });
        } else if (this.layerIndex < max) {
          this.renders.set(structName, { mode: RenderMode.SingleLayer, layerIndex: this.layerIndex - ori });
        } else {
          this.renders.set(structName, { mode: RenderMode.Off, layerIndex: max });
        }
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

    database.set('renderMode', this.mode);
    database.set('layerIndex', this.layerIndex);

    database.close();
    return this;
  }

  render() {
    if (this.interrupt) this.interrupt = false;
    for (const [structName, renderData] of this.renders) {
      switch (renderData.mode) {
        case RenderMode.All:
          RenderTool.renderAllBlocks(structName);
          break;
        case RenderMode.SingleLayer:
          RenderTool.renderLayerBlocks(structName, renderData.layerIndex);
          break;
        case RenderMode.BelowLayer:
          RenderTool.renderBelowLayerBlocks(structName, renderData.layerIndex);
          break;
        case RenderMode.AboveLayer:
          RenderTool.renderAboveLayerBlocks(structName, renderData.layerIndex);
          break;
        case RenderMode.Off:
          break;
        default:
          throw new Error(`Unknown render mode: ${renderData.mode} for structure ${structName}`);
      }
    }
  }

  async getMaterials(structName, player) {
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

export const Render = new RenderMgr();

export function RenderInit() {
  if (typeof Event === 'undefined') throw new Error("Event module is required for Render module.");
  if (typeof manager === 'undefined') throw new Error("Manager module is required for Render module.");
  if (particleLifetime < 50) throw new Error("unsafe particleLifetime setting in config.json, it should be at least 50ms.");
  
  ps = new ParticleSpawner(displayRadius, false, false); // 在这里初始化
  
  Render.init();
  setInterval(() => {
    Render.render();
  }, particleLifetime - 50);
  // logger.info("Render module initialized.");
}