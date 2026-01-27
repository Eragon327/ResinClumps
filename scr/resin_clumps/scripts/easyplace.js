import { Event, Events } from "../core/event.js";
import { manager } from "../core/manager.js";
import { Wand, WandMode } from "../core/wand.js";
import { Container, addRank } from "./container.js";
import { Render, RenderMode } from "../render/index.js";
import { Nbt } from "../utils/nbt.js";
import { HelperUtils } from "../utils/helpers.js";

const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '[]');
const blacklist = configFile.get('BlackList', []);
const rankAdaption = configFile.get('rankAdaption', false);
configFile.close();

export class EasyPlace {
  placeMode = PlaceMode.Normal;
  placed = false;

  static run() {
    for (const player of mc.getOnlinePlayers()) {
      if (player.hasTag('LitematicaToolOn') &&
        player.getHand().type === "minecraft:fishing_rod") {
        try {
          if (Wand.getMode(player) === WandMode.EasyPlacing) {
            EasyPlace.#doEasyPlace(player);
          }
        } catch (e) {
          logger.error(`Error in EasyPlace for player ${player.name}: ${e}`);
        }
      }
    }
  }
  

  static #doEasyPlace(player) {
    const controlingStructName = Wand.getControlingStruct(player);

    const viewVector = player.direction;
    const startPos = player.pos;
    // pos 返回的是眼睛坐标, 无需调整
    
    const yawRad = viewVector.yaw * (Math.PI / 180);
    const pitchRad = viewVector.pitch * (Math.PI / 180);
        
    const sinYaw = Math.sin(yawRad);
    const cosYaw = Math.cos(yawRad);
    const sinPitch = Math.sin(pitchRad);
    const cosPitch = Math.cos(pitchRad);

    const vecX = -cosPitch * sinYaw;;
    const vecY = -sinPitch;
    const vecZ = cosPitch * cosYaw;

    let lastBx = -999999, lastBy = -999999, lastBz = -999999;

    // 步长 0.2, 保证检测精度
    for (let dist = 1; dist <= 8; dist += 0.2) {
      const bx = Math.floor(startPos.x + vecX * dist);
      const by = Math.floor(startPos.y + vecY * dist);
      const bz = Math.floor(startPos.z + vecZ * dist);

      if (bx === lastBx && by === lastBy && bz === lastBz) continue;
      lastBx = bx; lastBy = by; lastBz = bz;

      const currentBlock = mc.getBlock(bx, by, bz, player.pos.dimid);
      if (!currentBlock) continue;

      const isAir = currentBlock.type === "minecraft:air";
      const isLiquid = ["minecraft:water",
        "minecraft:flowing_water",
        "minecraft:lava",
        "minecraft:flowing_lava"]
        .includes(currentBlock.type);

      if (!isAir && !isLiquid) return;

      if (manager.hasStructure(controlingStructName) &&
        !EasyPlace.#needSkip(controlingStructName, by)) {
        if (EasyPlace.#tryPlaceBlock(bx, by, bz, player.pos.dimid, controlingStructName, player)) return;
        
      }

      for (const name of manager.getAllStructureNames()) {
        if (name === controlingStructName) continue;
        if (EasyPlace.#needSkip(name, by)) continue;
        if (EasyPlace.#tryPlaceBlock(bx, by, bz, player.pos.dimid, name, player)) return;
      }
    }
  }

  static #tryPlaceBlock(bx, by, bz, dimid, name, player) {
    const originPos = manager.getOriginPos(name);
    const sx = bx - originPos.x;
    const sy = by - originPos.y;
    const sz = bz - originPos.z;

    const size = manager.getSize(name);
    if (sx < 0 || sy < 0 || sz < 0 ||
      sx >= size.x || sy >= size.y || sz >= size.z)
      return false;
    
    const { blockData, isWaterLogged } = manager.getBlockData(name, { x: sx, y: sy, z: sz });
    if (!blockData) return false;

    if (blockData.name === "minecraft:air" ||
      blacklist.includes(blockData.name))
      return false;

    if (!player.isCreative &&
      !Container.hasBlockItem(player, blockData.name))
      return false;
    
    mc.setBlock(bx, by, bz, dimid, Nbt.ObjectToNbt(blockData));

    // Event.trigger(Events.RENDER_REFRESH_GRIDS, name, {x: bx, y: by, z: bz});

    if (player.isCreative) return true;

    let countToRemove = 1;

    if (blockData.name.endsWith("minecraft:candle")) {  // 17色蜡烛
      countToRemove = blockData.states.candles;
    } else if (["minecraft:wildflowers",
      "minecraft:minecraft:pink_petals",
      "minecraft:leaf_litter",
    ].includes(blockData.name)
    ) {  // 野花簇, 粉红色花簇, 枯叶堆
      countToRemove = blockData.states.growth + 1;
    } else if (blockData.name === "minecraft:turtle_egg") {   // 海龟蛋
      countToRemove = HelperUtils.enToNumber(blockData.states.turtle_egg_count);
    } else if (blockData.name === "minecraft:glow_lichen" ||
      blockData.name === "minecraft:sculk_vein") {   // 发光地衣 & 幽匿脉络
      countToRemove = HelperUtils.countOnes(blockData.states.multi_face_direction_bits);
    } else if (blockData.name === "minecraft:sea_pickle") {   // 海泡菜
      countToRemove = blockData.states.cluster_count + 1;
    }

    Event.trigger(Events.CONTAINER_REMOVE_BLOCK_ITEM, player, blockData.name, countToRemove);

    if (rankAdaption) {
      addRank(player, countToRemove);
    }

    return true;
  }

  static #needSkip(structName, by) {
    let skip = false;
    switch (Render.getMode(structName)) {
      case RenderMode.All:
        break;
      case RenderMode.SingleLayer:
        if ((by - manager.getOriginPos(structName).y) !== Render.getLayerIndex(structName)) skip = true;
        break;
      case RenderMode.BelowLayer:
        if ((by - manager.getOriginPos(structName).y) > Render.getLayerIndex(structName)) skip = true;
        break;
      case RenderMode.AboveLayer:
        if ((by - manager.getOriginPos(structName).y) < Render.getLayerIndex(structName)) skip = true;
        break;
      case RenderMode.Off:
        skip = true;
        break;
    }
    return skip;
  }
}

export class PlaceMode {
  static Normal = 0;
  static Range  = 1;  // TODO: 范围打印

  static init() {
    const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '{}');
    EasyPlace.placeMode = configFile.get('EasyPlaceMode', 0);
    configFile.close();

    Event.listen(Events.EASYPLACE_CHANGE_PLACE_MODE, this.#changePlaceMode.bind(this));
  }

  static #changePlaceMode(newMode) {
    EasyPlace.placeMode = newMode;
    const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '{}');
    configFile.set('EasyPlaceMode', newMode);
    configFile.close();
  }
}

export function EasyPlaceInit() {
  mc.listen("onTick", EasyPlace.run);
  /*
  mc.listen("afterPlaceBlock", (player, block) => { 
      Event.trigger(Events.RENDER_REFRESH_GRIDS, block.pos); 
  });
  mc.listen("onDestroyBlock", (player, block) => { 
      setTimeout(() => Event.trigger(Events.RENDER_REFRESH_GRIDS, block.pos), 1); // 等 BDS 处理完再刷新
  });
  */
  mc.listen("onBlockChanged", (_before, after) => { 
      setTimeout(() => Event.trigger(Events.RENDER_REFRESH_GRIDS, after.pos), 1); // 等 BDS 处理完再刷新
  });
  // logger.info("EasyPlace module initialized.");
}