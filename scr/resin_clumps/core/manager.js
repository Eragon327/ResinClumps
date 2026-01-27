import { Event, Events } from "./event.js";
import { Render, RenderMode } from "../render/index.js";
import { Structure } from "../scripts/structure.js";
import { Nbt } from "../utils/nbt.js";

class Manager {
  constructor() {
    this.cache = new Map();
    // structName -> { filePath: string, struct: Structure, originPos: IntPos, posLocked: boolean }
    this.structureList = [];
  }

  placeMode = 0;

  init() {
    this.#updateStructList();
    Event.listen(Events.MANAGER_ADD_STRUCTURE, this.#addStructure.bind(this));
    Event.listen(Events.MANAGER_REMOVE_STRUCTURE, this.#removeStructure.bind(this));
    Event.listen(Events.MANAGER_UPDATE_DATA, this.#updateData.bind(this));
    Event.listen(Events.MANAGER_UPDATE_STRUCT_LIST, this.#updateStructList.bind(this));
    Event.listen(Events.MANAGER_CHANGER_ORIGIN_POS, this.#changerOriginPos.bind(this));
    Event.listen(Events.MANAGER_CHANGER_LOCK_POS, this.#changerLockPos.bind(this));
    Event.listen(Events.MANAGER_PASTE_STRUCTURE, this.#pasteStructure.bind(this));
    Event.listen(Events.MANAGER_GET_MATERIALS, this.#getMaterials.bind(this));
  }

  #addStructure(filePath, originPos, structName = null) {
    if(!File.exists(filePath)) throw new Error(`Structure file ${filePath} does not exist`);
    const struct = Structure.load(filePath);
    if (!struct) throw new Error(`Failed to load structure from ${filePath}`);
   
    const name = structName ?? filePath.substring(filePath.lastIndexOf('/') + 1).replace('.mcstructure', '');

    if(this.cache.has(name)) {
      throw new Error(`Structure name ${structName} already exists in cache`);
    }

    this.cache.set(name, { filePath, struct, originPos, posLocked: false });
    //this.#updateCacheToFile(); 手动更新
  }

  #removeStructure(structName) {
    if (this.cache.has(structName)) {
      this.cache.delete(structName);
      //this.#updateCacheToFile(); 手动更新
    }
  }

  #changerOriginPos(structName, originPos) {
    if (this.cache.has(structName)) {
      this.cache.get(structName).originPos = originPos;
      //this.#updateCacheToFile(); 手动更新
    }
  }

  #changerLockPos(structName, posLocked) {
    if (this.cache.has(structName)) {
      this.cache.get(structName).posLocked = posLocked;
      //this.#updateCacheToFile(); 手动更新
    }
  }

  #updateData() {
    const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
    const structObj = {};
    for (const [name, item] of this.cache.entries()) {
      const old = database.get('structures', {})[name] || {};
      structObj[name] = {
        filePath: item.filePath,
        originPos: { x: item.originPos.x, y: item.originPos.y, z: item.originPos.z, dimid: item.originPos.dimid },
        posLocked: item.posLocked,
        mode: old.mode ?? RenderMode.All,
        layerIndex: old.layerIndex ?? 0,
      };
    }
    database.set('structures', structObj);
    database.close();
    return this;
  }

  #updateStructList() {
    this.structureList.length = 0;
    File.getFilesList("./plugins/ResinClumps/structure/").map(fileName => {
      if (fileName.endsWith(".mcstructure")) {
        this.structureList.push(fileName.replace('.mcstructure', ''));
      }
    });
  }

  async #pasteStructure(structName, player) {
    if(!player.isCreative) logger.fatal(`发现玩家 ${player.realName} 非创造模式使用粘贴功能！`);
    const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '{}');
    const maxPasteSpeed = configFile.get('maxPasteSpeed', 65535);
    configFile.close();
    const originPos = this.getOriginPos(structName);
    const size = this.getSize(structName);
    let index = 0;
    let placeCount = 0;
    const interval = setInterval(() => {
      player.sendText(`正在粘贴原理图 §l${structName}`, 5);
    }, 1000);
    for (let y = 0; y < size.y; y++) {
      for (let x = 0; x < size.x; x++) {
        for (let z = 0; z < size.z; z++) {
          const bx = originPos.x + x;
          const by = originPos.y + y;
          const bz = originPos.z + z;
          const dimid = originPos.dimid;
          const { blockData, isWaterLogged } = this.getBlockData(structName, index);
          try {
            // 不能放含水方块, 因为无法判断是含水源还是含水流
            // if (isWaterLogged) { }

            const block = mc.getBlock(bx, by, bz, dimid);
            if (!block || block.type !== blockData.name) {
              if (placeCount >= maxPasteSpeed) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                placeCount = 0;
              }

              switch (blockData.name) {
                case "minecraft:air":
                case "minecraft:flowing_water":
                case "minecraft:flowing_lava": break;
                case "minecraft:bubble_column":
                  await Manager.#placeOneBlock(bx, by, bz, dimid, "minecraft:water", "minecraft:water"); //  实际上, 传字符串也能跑
                  placeCount++;
                  break;
                case "minecraft:wooden_door":
                case "minecraft:spruce_door":
                case "minecraft:birch_door":
                case "minecraft:jungle_door":
                case "minecraft:acacia_door":
                case "minecraft:dark_oak_door":
                case "minecraft:mangrove_door":
                case "minecraft:cherry_door":
                case "minecraft:pale_oak_door":
                case "minecraft:bamboo_door":
                case "minecraft:crimson_door":
                case "minecraft:warped_door":
                case "minecraft:iron_door":
                case "minecraft:copper_door":
                case "minecraft:exposed_copper_door":
                case "minecraft:weathered_copper_door":
                case "minecraft:oxidized_copper_door":
                case "minecraft:waxed_copper_door":
                case "minecraft:waxed_exposed_copper_door":
                case "minecraft:waxed_weathered_copper_door":
                case "minecraft:waxed_oxidized_copper_door":
                  // 门怎么放置都会出错
                  break;
                default:
                  await Manager.#placeOneBlock(bx, by, bz, dimid, Nbt.ObjectToNbt(blockData), blockData.name);
                  placeCount++;
                  break;
              }
            }
          } catch (e) { logger.error(`Error placing block at (${bx}, ${by}, ${bz}): ${e.message}`); }
          index++;
        }
      }
    }
    clearInterval(interval);

    setTimeout(() => Event.trigger(Events.RENDER_REFRESH_GRIDS, structName), 1);

    player.sendText(`原理图 §l${structName} §r已粘贴至世界! `, 5);
  }

  static async #placeOneBlock(bx, by, bz, dimid, nbt, name) {
    if(mc.getBlock(bx, by, bz, dimid)?.type === name) return;
    // 先尝试同步放置
    if (mc.setBlock(bx, by, bz, dimid, nbt)) return;

    // 每 50 ms 尝试一次, 直到成功放置
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        logger.info(`Retrying to place block at (${bx}, ${by}, ${bz}) in dim ${dimid}... expected: ${nbt.toString()}`);
        const success = mc.setBlock(bx, by, bz, dimid, nbt);
        if (success) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  }

  getAllBlocksNum(structName) {
    if (!this.hasStructure(structName)) return null;
    const size = this.getSize(structName);
    let result = 0;
    const endIndex = size.x * size.y * size.z;
    for (let index = 0; index < endIndex; index++) {
      const { blockData } = this.getBlockData(structName, index);
      if (blockData.name !== "minecraft:air" && 
        !blockData.name.includes('flowing_')) result++;
    }
    return result;
  }

  async #getMaterials(structName, player) {
    if (!this.hasStructure(structName)) {
      Event.trigger(Events.GUI_SEND_MATERIALS, player, [], 0);
      return;
    }
  
    const pendingBlocks = new Map(); // blockName -> count
    
    const originPos = this.getOriginPos(structName);
    const size = this.getSize(structName);
    
    const progressInterval = setInterval(() => {
      player.sendText(`正在获取材料列表 §l${structName}`, 5);
    }, 1000);
  
    let index = 0;
    for (let y = 0; y < size.y; y++) {
      for (let x = 0; x < size.x; x++) {
        for (let z = 0; z < size.z; z++) {
          const { blockData } = this.getBlockData(structName, index);
          const targetName = blockData.name;
          
          // 跳过空气
          if (targetName === "minecraft:air") {
            index++;
            continue;
          }

          const needFix = await Manager.#needOneBlock(
            originPos.x + x,
            originPos.y + y,
            originPos.z + z,
            originPos.dimid,
            targetName
          );
          
          if (needFix) {
            pendingBlocks.set(targetName, (pendingBlocks.get(targetName) || 0) + 1);
          }
          
          index++;
        }
      }
    }
  
    clearInterval(progressInterval);
  
    // 转换为结果数组
    const results = Array.from(pendingBlocks.entries()).map(([blockName, count]) => ({ blockName, count }));
    
    Event.trigger(Events.GUI_SEND_MATERIALS, player, results, manager.getAllBlocksNum(structName));
  }
  
  // 核心优化：同步优先 + 无限重试
  static #needOneBlock(bx, by, bz, dimid, expectedName) {
    return new Promise(resolve => {
      // 优先同步尝试
      const block = mc.getBlock(bx, by, bz, dimid);
      if (block) {
        // 同步resolve, await立即继续
        return resolve(Manager.#checkNeed(block.type, expectedName));
      }
      
      // 每 50 ms 尝试获取方块状态，直到成功
      const interval = setInterval(() => {
        const block = mc.getBlock(bx, by, bz, dimid);
        if (block) {
          clearInterval(interval);
          resolve(Manager.#checkNeed(block.type, expectedName));
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

  // TODO: 材料列表放到 Render 模块, 只获取当前渲染模式下的材料需求

  hasStructure(structName) {
    return this.cache.has(structName);
  }

  getAllStructureNames() {
    return Array.from(this.cache.keys());
  }

  getAllFileStructureNames() {
    return this.structureList;
  }

  getBlockData(structName, index) {
    if (!this.hasStructure(structName)) return null;
    let i;
    if (typeof index === 'number') {
      if (index < 0 || index >= this.cache.get(structName).struct.structure.block_indices[0].length) {
        throw new Error('Index out of bounds');
      }
      i = index;
    } else if (typeof index === 'object' && index.x !== undefined && index.y !== undefined && index.z !== undefined) {
      const size = this.cache.get(structName).struct.size;
      if (index.x < 0 || index.x >= size[0] || index.y < 0 || index.y >= size[1] || index.z < 0 || index.z >= size[2]) {
        throw new Error('Index out of bounds');
      }
      i = index.y * size[0] * size[2] + index.x * size[2] + index.z;
    } else {
      throw new Error('Invalid index format');
    }

    const struct = this.cache.get(structName).struct;
    const blockIndex = struct.structure.block_indices[0][i];
    const blockPalette = struct.structure.palette.default.block_palette;
    const isWaterLogged = struct.structure.block_indices[1][i] !== -1;
    const blockData = blockPalette[blockIndex];

    return { blockData, isWaterLogged };
  }

  getSize(structName) {
    if (!this.hasStructure(structName)) return null;
    const size = this.cache.get(structName).struct.size;
    return { x: size[0], y: size[1], z: size[2] };
  }

  getOriginPos(structName) {
    if (!this.hasStructure(structName)) return null;
    return this.cache.get(structName).originPos;
  }

  isLockedPos(structName) {
    if (!this.hasStructure(structName)) return null;
    return this.cache.get(structName).posLocked;
  }
}

export const manager = new Manager();

export function ManagerInit() {
  if (typeof Event === 'undefined') throw new Error("Event module is required for Render module.");
  if (typeof Render === 'undefined') throw new Error("Render module is required for Manager module.");

  manager.init();

  const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
  const structObj = database.get('structures', {});
  database.close();
  for (const [structName, item] of Object.entries(structObj)) {
    try {
      if (File.exists(item.filePath)) {
        Event.trigger(Events.MANAGER_ADD_STRUCTURE, item.filePath,
          new IntPos(item.originPos.x, item.originPos.y, item.originPos.z, item.originPos.dimid,
            structName));
        Event.trigger(Events.RENDER_SET_RENDER_MODE, structName, item.mode ?? RenderMode.All);
        Event.trigger(Events.RENDER_SET_LAYER_INDEX, structName, item.layerIndex ?? 0);
      } else {
        logger.warn(`Structure file ${item.filePath} for structure ${structName} does not exist, skipping load.`);
      }
    } catch (e) {
      logger.error(`Failed to reload structure ${structName} from ${item.filePath}: ${e.message}`);
    }
  }
  Event.trigger(Events.MANAGER_UPDATE_DATA);

  logger.info("All structures reloaded from database.");
  // logger.info("Manager Module initialized.");
}
