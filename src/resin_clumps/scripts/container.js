import { Event, Events } from "../core/event.js";

export class Container {  // 全静态类
  static hasBlockItem(player, blockType) {
    if (!player) return false;
    const inv = player.getInventory();
    for (const item of inv.getAllItems()) {
      if (!item.isBlock) continue;
      const itemObj = JSON.parse(item.getNbt().toString());  // 旧版本 LSE 的 toObject() 有 Bug
      // const itemObj = item.getNbt().toObject();           // 新版本 LSE 的 toObject() 已修复该 Bug
      if (itemObj.Block.name === blockType) return true;
      if (itemObj.Name.endsWith('shulker_box')) {
        if (!itemObj.tag) continue;
        for (const itemInBox of itemObj.tag.Items) {
          if (!itemInBox.Block) continue;
          if (itemInBox.Block.name === blockType) return true;
        }
      }
    }
    return false;
  }

  static removeBlockItem(player, blockType, count = 1) {
    if (!player || count <= 0) return;
    const inv = player.getInventory();
    let index = -1;
    for (const item of inv.getAllItems()) {
      index++;
      if (!item.isBlock) continue;
      const itemObj = JSON.parse(item.getNbt().toString());  // 旧版本 LSE 的 toObject() 有 Bug
      // const itemObj = item.getNbt().toObject();           // 新版本 LSE 的 toObject() 已修复该 Bug
      if (itemObj.Block.name === blockType) {
        inv.removeItem(index, count);
        player.refreshItems();
        return;
      }
      if (itemObj.Name.endsWith('shulker_box')) {
        if (!itemObj.tag) continue;
        let indexInBox = -1;
        for (const itemInBox of itemObj.tag.Items) {
          indexInBox++;
          if (!itemInBox.Block) continue;
          if (itemInBox.Block.name === blockType) {
            const nbt = item.getNbt();
            const newNbt = Container.#shulkerBoxReduceItem(nbt, indexInBox, count);
            item.set(mc.newItem(newNbt));
            player.refreshItems();
            return;
          }
        }
      }
    }
  }

  static #shulkerBoxReduceItem(shulkerNbt, index, count = 1) {
    // 全程操作 NBT, 避免各种奇葩问题
    const itemNbt = shulkerNbt.getTag('tag').getTag('Items').getTag(index);
    const currentCount = itemNbt.getTag('Count');
    if(count >= currentCount) {
      // 删除该物品
      shulkerNbt.getTag('tag').getTag('Items').removeTag(index);
      if(shulkerNbt.getTag('tag').getTag('Items').getSize() === 0) {
        // 如果没有物品了, 则清除 tag 标签
        shulkerNbt.removeTag('tag');
      }
    } else {
      // 减少数量
      const newCount = currentCount - count;
      itemNbt.getTag('Count').set(newCount);
    }
    return shulkerNbt;
  }
}

let func = null;
let place = null;
export function ContainerInit() {
  if(typeof Event === 'undefined') throw new Error("Event module is required for Container module.");
  Event.listen(Events.CONTAINER_REMOVE_BLOCK_ITEM, Container.removeBlockItem);

  // 直接把函数导出代码注入到排行榜文件中
  const configFile = new JsonConfigFile("./plugins/ResinClumps/config/config.json", '{}');
  const rankAdaption = configFile.get('rankAdaption', false);
  configFile.close();
  if (rankAdaption) {
    if (File.exists("./plugins/B-Ranking/manifest.json")) { // 兼容 B-Ranking 插件
      if (!File.readFrom("./plugins/B-Ranking/B-Ranking.js").endsWith("// ResinClumps automatic generated\n")) {
        File.writeLine("./plugins/B-Ranking/B-Ranking.js",
          '\nll.exports(handleScoreEvent, "BRanking", "handleScoreEvent"); \n// ResinClumps automatic generated');
        mc.runcmd("ll reload B-Ranking");
      }
      func = ll.imports("BRanking", "handleScoreEvent");
      place = "place";
    } else if (File.exists("./plugins/Ranking/manifest.json")) { // 兼容 Ranking 插件
      if (!File.readFrom("./plugins/Ranking/Ranking.js").endsWith("// ResinClumps automatic generated\n")) {
        File.writeLine("./plugins/Ranking/Ranking.js",
          '\nll.exports(Ranking.EventTriggered.bind(Ranking), "Ranking", "EventTriggered"); \n// ResinClumps automatic generated');
        mc.runcmd("ll reload Ranking");
      }
      func = ll.imports("Ranking", "EventTriggered");
      place = "Place";  // 怎么还有区分大小写的？
    }
  }

  // logger.info("Container module initialized.");
}

export function addRank(player, scoreToAdd) {
  if (typeof func !== 'function') return;
  for(let i = 0; i < scoreToAdd; i++) func(player, place);
}
