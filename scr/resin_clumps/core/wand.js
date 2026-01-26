import { Event, Events } from "./event.js";
import { manager } from "./manager.js";
import { Render } from "../render/index.js";
import { HelperUtils } from "../utils/helpers.js";

class WandMgr {
  constructor() {
    this.playerDatas = new Map();
    // Map<Player, { mode: WandMode, controlingStruct: string|null }>;
  }

  getMode(player) {
    return this.playerDatas.get(player.uuid).mode;
  }

  getControlingStruct(player) {
    return this.playerDatas.get(player.uuid).controlingStruct;
  }

  init() {
    mc.listen("onSpawnProjectile", this.toolEvent.bind(this));
    mc.listen("onJoin", this.joinEvent.bind(this));

    Event.listen(Events.WAND_ADD_PLAYER, this.#addPlayer.bind(this));
    Event.listen(Events.WAND_REMOVE_PLAYER, this.#removePlayer.bind(this));
    Event.listen(Events.WAND_CHANGE_MODE, this.#changeMode.bind(this));
    Event.listen(Events.WAND_CHANGE_CONTROLING_STRUCT, this.#changeControlingStruct.bind(this));
    Event.listen(Events.WAND_UPDATE_DATA, this.#updatePlayerDataToFile.bind(this));

    const structNames = manager.getAllStructureNames();

    let database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
    const playerDataObj = database.get('player', {});
    database.close();
    for (const [playerUUID, playerData] of Object.entries(playerDataObj)) {
      const controlingStruct = structNames.includes(playerData.controlingStruct) ? playerData.controlingStruct : (structNames.length > 0 ? structNames[0] : null);
      this.playerDatas.set(playerUUID, { mode: playerData.mode, controlingStruct });
    }

    this.#updatePlayerDataToFile();

    database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
    const oldID = database.get('showMessageID', null);
    try {
      if (typeof oldID === "number") clearInterval(oldID);
    } catch (e) { }
    database.set('showMessageID', setInterval(this.showMessage.bind(this), 1000));
    database.close();

    // logger.info("Wand Manager initialized.");
  }
  
  showMessage() {
    for (const [playerUUID, playerData] of this.playerDatas) {
      const player = mc.getPlayer(playerUUID);
      if (!player) continue;
      player.sendText(`当前模式 ${WandMode.modes_zh[Math.abs(playerData.mode)]}`, 4);
    }
  }

  toolEvent(shooter, type) {
    const player = shooter.toPlayer();
    if (type === 'minecraft:fishing_hook' &&
      this.playerDatas.has(player.uuid) &&
      this.getMode(player) !== WandMode.OFF) {
      if (this.#hasPlayer(player)) {
        this.#onToolUse(player);
        return false; // 返回 false 拦截钓鱼线生成
      }
    }
    return true;  // 放行让玩家正常钓鱼
  }

  joinEvent(player) {
    if (!this.#hasPlayer(player)) {
      this.#addPlayer(player);
      this.#updatePlayerDataToFile(player);
    }
  }
  
  #hasPlayer(player) {
    return this.playerDatas.has(player.uuid);
  }

  #addPlayer(player) {
    this.playerDatas.set(player.uuid, { mode: WandMode.Placing, controlingStruct: null });
    // this.#updatePlayerDataToFile(player);
    return this;
  }

  #removePlayer(player) {
    this.playerDatas.delete(player);
    // this.#updatePlayerDataToFile(player);
    return this;
  }

  #changeMode(player, mode) {
    this.playerDatas.get(player.uuid).mode = mode;

    let text = `已切换到模式: §l${WandMode.getModeName(mode)}`;
    if( mode === WandMode.EasyPlacing) {
      text += "\n§r轻松放置 §l§a开启";
    }
    player.sendText(text, 5);
    
    // this.#updatePlayerDataToFile(player);
    return this;
  }

  #changeControlingStruct(player, structName) {
    if (!manager.hasStructure(structName) && structName !== null) {
      throw new Error(`Structure ${structName} not found in cache`);
    } else {
      this.playerDatas.get(player.uuid).controlingStruct = structName;
    }
    // this.#updatePlayerDataToFile(player);
    return this;
  }

  #updatePlayerDataToFile(player = null) {  // null 则更新所有玩家数据, 分离主动调用
    const database = new JsonConfigFile("./plugins/ResinClumps/config/database.json", '{}');
    const playerData = database.get('player', {});
    if (player) {
      const data = this.playerDatas.get(player.uuid);
      playerData[player.uuid] = data;
    } else {
      for (const [playerUUID, data] of this.playerDatas) {
        playerData[playerUUID] = data;
      }
    }
    database.set('player', playerData);
    database.close();
  }

  #onToolUse(player) {
    switch (this.getMode(player)) {
      case WandMode.Placing:
        this.#placeStructure(player);
        break;
      case WandMode.EasyPlacing:
      case WandMode.EasyPlacingOff:
        this.#easyPlace(player);
        break;
      default:
        throw new Error(`Unknown mode: ${this.getMode(player)}`);
    }
  }

  #placeStructure(player) {
    const structName = this.getControlingStruct(player);
    if(manager.isLockedPos(structName)) {
      player.sendText("§c原理图位置已锁定, 无法移动原理图！", 5);
      return;
    }
    if (!structName) {
      player.sendText("§c未选择结构, 无法放置结构！", 5);
      return;
    }
    if (player.isSneaking) {
      const baseDirection = HelperUtils.toBaseDirection(player.direction);
      const originPos = manager.getOriginPos(structName);
      originPos.x += baseDirection.x;
      originPos.y += baseDirection.y;
      originPos.z += baseDirection.z;
      Event.trigger(Events.MANAGER_CHANGER_ORIGIN_POS, structName, originPos);
    } else {
      const block = player.getBlockFromViewVector(false, false, 255, false);
      if (!block) {
        player.sendText("§c未选中方块, 无法移动原理图！", 5);
        return;
      }
      Event.trigger(Events.MANAGER_CHANGER_ORIGIN_POS, structName, block.pos);
      player.sendText(`已将原理图移动到 (${block.pos.x}, ${block.pos.y}, ${block.pos.z})`, 5);
    }
    Event.trigger(Events.MANAGER_UPDATE_DATA);
  }

  #easyPlace(player) {
    const controlingStruct = this.getControlingStruct(player);
    if (player.isSneaking) {
      const mode = this.getMode(player);
      if (mode === WandMode.EasyPlacing) {
        this.#changeMode(player, WandMode.EasyPlacingOff);
        player.sendText("轻松放置 §l§c关闭", 5);
      } else if (mode === WandMode.EasyPlacingOff) {
        this.#changeMode(player, WandMode.EasyPlacing);
        player.sendText("轻松放置 §l§a开启", 5);
      } else {
        throw new Error(`Unknown mode: ${mode}`);
      }
      Event.trigger(Events.WAND_UPDATE_DATA, player);
    } else { 
      const d = HelperUtils.toBaseDirection(player.direction);
      const currentLayerIndex = Render.getLayerIndex(controlingStruct);
      let newLayerIndex = currentLayerIndex;
      switch (d.y) {
        case 1:
          newLayerIndex++;
          break;
        case -1:
          newLayerIndex--;
          break;
        case 0:
          newLayerIndex = -1; // 让后面拦截
          break;
      }
      const max = manager.getSize(controlingStruct).y - 1;
      if (newLayerIndex < 0 || newLayerIndex > max) {
        player.sendText("§c轻松放置阻止的操作", 5);
        return;
      }
      Event.trigger(Events.RENDER_SET_LAYER_INDEX, newLayerIndex, controlingStruct);
      player.sendText(`当前层高度: ${newLayerIndex}`, 5);
      Event.trigger(Events.RENDER_UPDATE_DATA, controlingStruct);
    }
  }
}

export const Wand = new WandMgr();

export class WandMode {
  static Placing        = 0;
  static EasyPlacing    = 1;
  static EasyPlacingOff = -1;
  static OFF            = 2;
  static modes_zh = ["放置原理图", "轻松放置", "关闭工具"];
  static getModeName(mode) {
    return WandMode.modes_zh[Math.abs(mode)];
  }
}

export function WandInit() {
  if (typeof Event === 'undefined') throw new Error("Event module is required for Wand module.");
  Wand.init();

  // logger.info("Wand module initialized.");
}