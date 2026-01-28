import { Event, Events } from "../core/event.js";
import { manager } from "../core/manager.js";
import { Wand, WandMode } from "../core/wand.js";
import { Container, addRank } from "./container.js";
import { Render, RenderMode } from "../render/index.js";
import { Nbt } from "../utils/nbt.js";
import { HelperUtils } from "../utils/helpers.js";

const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '[]');
const blacklist = configFile.get('BlackList', []);
const placeDistance = configFile.get('placeDistance', 5);
const placeInterval = configFile.get('placeInterval', 1);
const rankAdaption = configFile.get('rankAdaption', false);
configFile.close();

class EasyPlaceMgr {
  constructor() {
    this.placeMode = PlaceMode.Normal;
  }

  run() {
    const now = mc.getTime(1);
    if (now % placeInterval !== 0) return;
    for (const player of mc.getOnlinePlayers()) {
      if (Wand.getMode(player) === WandMode.EasyPlacing &&
        player.getHand().type === "minecraft:fishing_rod") {
        try {
          switch (this.placeMode) {
            case PlaceMode.Normal:
              EasyPlaceMgr.doEasyPlace(player);
              break;
            case PlaceMode.Range:
              EasyPlaceMgr.doRangePlace(player);
              break;
          }
        } catch (e) {
          logger.error(`Error in EasyPlace for player ${player.name}: ${e}`);
        }
      }
    }
  }
  

  static doEasyPlace(player) {
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
    for (let dist = 1; dist <= placeDistance; dist += 0.2) {
      const bx = Math.floor(startPos.x + vecX * dist);
      const by = Math.floor(startPos.y + vecY * dist);
      const bz = Math.floor(startPos.z + vecZ * dist);

      // 避免在玩家所在位置放置
      if (bx === Math.floor(player.feetPos.x) &&
        by === Math.floor(player.feetPos.y) &&
        bz === Math.floor(player.feetPos.z))
        continue;
      

      if (bx === lastBx && by === lastBy && bz === lastBz) continue;
      lastBx = bx; lastBy = by; lastBz = bz;

      const currentBlock = mc.getBlock(bx, by, bz, player.pos.dimid);
      if (!currentBlock) continue;

      if (EasyPlaceMgr.cantThrough(currentBlock.type)) return;

      if (manager.hasStructure(controlingStructName) &&
        !EasyPlaceMgr.needSkip(controlingStructName, by)) {
        if (EasyPlaceMgr.tryPlaceBlock(bx, by, bz, player.pos.dimid, controlingStructName, player)) return;
        
      }

      for (const name of manager.getAllStructureNames()) {
        if (name === controlingStructName) continue;
        if (EasyPlaceMgr.needSkip(name, by)) continue;
        if (EasyPlaceMgr.tryPlaceBlock(bx, by, bz, player.pos.dimid, name, player)) return;
      }
    }
  }

  static tryPlaceBlock(bx, by, bz, dimid, name, player) {
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

    const countToRemove = EasyPlaceMgr.getCount(blockData);

    Event.trigger(Events.CONTAINER_REMOVE_BLOCK_ITEM, player, blockData.name, countToRemove);

    if (rankAdaption) {
      addRank(player, countToRemove);
    }

    return true;
  }

  static getCount(blockData) {

    if (blockData.name.endsWith("minecraft:candle")) {  // 17色蜡烛
      return blockData.states.candles;
    }

    if (["minecraft:wildflowers",
      "minecraft:minecraft:pink_petals",
      "minecraft:leaf_litter",
    ].includes(blockData.name)
    ) {  // 野花簇, 粉红色花簇, 枯叶堆
      return blockData.states.growth + 1;
    }

    if (blockData.name === "minecraft:sea_pickle") {   // 海泡菜
      return blockData.states.cluster_count + 1;
    }

    if (blockData.name === "minecraft:turtle_egg") {   // 海龟蛋
      return HelperUtils.enToNumber(blockData.states.turtle_egg_count);
    }

    if(["minecraft:glow_lichen",
      "minecraft:sculk_vein"].includes(blockData.name)) {   // 发光地衣 & 幽匿脉络
      return HelperUtils.countOnes(blockData.states.multi_face_direction_bits);
    }

    return 1;
  }

  static needSkip(structName, by) {
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

  static doRangePlace(player) {
    const controlingStructName = Wand.getControlingStruct(player);
    const center = {
      x: Math.floor(player.feetPos.x),
      y: Math.floor(player.feetPos.y),
      z: Math.floor(player.feetPos.z),
      dimid: player.pos.dimid
    }

    const halfDist = Math.floor(placeDistance / 2) + 1;

    for (let dy = -halfDist; dy <= halfDist; dy++) {
      const by = center.y + dy;
      for (let dx = -halfDist; dx <= halfDist; dx++) {
        const bx = center.x + dx;
        for (let dz = -halfDist; dz <= halfDist; dz++) {
          const bz = center.z + dz;

          if (bx === center.x && by === center.y && bz === center.z) continue;

          const currentBlock = mc.getBlock(bx, by, bz, center.dimid);
          if (!currentBlock) continue;

          if (EasyPlaceMgr.cantThrough(currentBlock.type)) continue;

          if (manager.hasStructure(controlingStructName) &&
            !EasyPlaceMgr.needSkip(controlingStructName, by)) {
            if (EasyPlaceMgr.tryPlaceBlock(bx, by, bz, center.dimid, controlingStructName, player)) continue;
          }

          for (const name of manager.getAllStructureNames()) {
            if (name === controlingStructName) continue;
            if (EasyPlaceMgr.needSkip(name, by)) continue;
            if (EasyPlaceMgr.tryPlaceBlock(bx, by, bz, center.dimid, name, player)) break;
          }
        }
      }
    }
  }

  static cantThrough(blockType) {
    return blockType !== "minecraft:air" &&
      ["minecraft:water",
        "minecraft:flowing_water",
        "minecraft:lava",
        "minecraft:flowing_lava"]
        .includes(blockType) === false;
  }

}

export class PlaceMode {
  static Normal = 0;
  static Range  = 1;  // TODO: 范围打印
  static modes_zh = ["常规", "范围放置"];

  static init() {
    const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '{}');
    EasyPlace.placeMode = configFile.get('EasyPlaceMode', 0);
    configFile.close();

    Event.listen(Events.EASYPLACE_CHANGE_PLACE_MODE, PlaceMode.#changePlaceMode);
  }

  static #changePlaceMode(newMode) {
    EasyPlace.placeMode = newMode;
    const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '{}');
    configFile.set('EasyPlaceMode', newMode);
    configFile.close();
  }
}

export const EasyPlace = new EasyPlaceMgr();

export function EasyPlaceInit() {
  PlaceMode.init();
  mc.listen("onTick", EasyPlace.run.bind(EasyPlace));
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