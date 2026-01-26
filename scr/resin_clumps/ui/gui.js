import { Event, Events } from "../core/event.js";
import { Wand, WandMode } from "../core/wand.js";
import { manager } from "../core/manager.js";
import { Render, RenderMode } from "../render/index.js";
import { HelperUtils } from "../utils/helpers.js";

class GUI {
  static sendMainForm(player) {
    const mode = Wand.getMode(player);
    const form = mc.newSimpleForm();
    form.setTitle("ResinClumps 主菜单");
    form.setContent("请选择操作: ");
    form.addButton(`当前模式: ${WandMode.modes_zh[Math.abs(mode)]}`);
    form.addButton("加载原理图");
    form.addButton("管理原理图");
    form.addButton("配置");
    player.sendForm(form, GUI.#mainFormCallback);
  }

  static #mainFormCallback(player, id) {
    if (id === undefined) return;
    switch (id) {
      case 0:
        GUI.#sendModeChangeForm(player);
        break;
      case 1:
        GUI.#sendLoadStructureForm(player);
        break;
      case 2:
        GUI.#sendLoadedStructureForm(player);
        break;
      case 3:
        GUI.#sendOptionsForm(player);
        break;
    }
  }

  static #sendModeChangeForm(player) {
    const form = mc.newCustomForm();
    form.setTitle("选择工具模式");
    const mode = Wand.getMode(player);
    form.addStepSlider("工具模式", WandMode.modes_zh, Math.abs(mode));
    form.setSubmitButton("确定");
    player.sendForm(form, GUI.#modeChangeFormCallback);
  }

  static #modeChangeFormCallback(player, data) {
    if (data === undefined) return;
    const mode = data[0];
    Event.trigger(Events.WAND_CHANGE_MODE, player, mode);
    Event.trigger(Events.WAND_UPDATE_DATA, player);
    // player.sendText(`已切换到模式: §l${WandMode.getModeName(mode)}`, 5); 这个放到 wand.js 里触发模式变更事件时提示
  }

  // 本来想加载页面再套一层, 显示材料数量和确认/反悔按钮, 但是显示材料数量就已经读取了结构文件, 已经造成卡顿, 所以反悔就没必要了

  static #sendLoadStructureForm(player) {
    Event.trigger(Events.MANAGER_UPDATE_STRUCT_LIST);
    const form = mc.newSimpleForm();
    form.setTitle("加载原理图");
    for (const name of manager.getAllFileStructureNames()) {
        form.addButton(name);
    }
    form.addButton("<<")
    player.sendForm(form, GUI.#loadStructureFormCallback);
  }

  static #loadStructureFormCallback(player, id) {
    if (id === undefined) return;
    if (id === manager.getAllFileStructureNames().length) {
      GUI.sendMainForm(player);
      return;
    }
    const name = manager.getAllFileStructureNames()[id];
    const originPos = new IntPos(Math.floor(player.feetPos.x), Math.floor(player.feetPos.y), Math.floor(player.feetPos.z), player.feetPos.dimid);

    let structName = name;
    let count = 1;
    while (manager.hasStructure(structName)) {
      structName = `${name}_${count}`;
      count++;
    }

    try {
      Event.trigger(Events.MANAGER_ADD_STRUCTURE, `./plugins/ResinClumps/structure/${name}.mcstructure`, originPos, structName);
      Event.trigger(Events.MANAGER_UPDATE_DATA);
      //Event.trigger(Events.RENDER_UPDATE_DATA);
      Event.trigger(Events.WAND_ADD_PLAYER, player);
      Event.trigger(Events.WAND_CHANGE_MODE, player, WandMode.Placing);
      Event.trigger(Events.WAND_CHANGE_CONTROLING_STRUCT, player, structName);
      Event.trigger(Events.WAND_UPDATE_DATA, player);
    } catch (e) {
      player.sendText(`§c加载原理图 §l${name} §r§c失败`, 5);
      logger.error(`Failed to load structure ${name}: ${e.message}`);
      return;
    }
    let text = `原理图 §l${name} §r已加载`;
    if (count > 1) text += ` 为 §l${structName}§r`;
    const renderMode = Render.getMode();
    if(renderMode !== RenderMode.All) text += `\n请注意当前渲染模式为: ${RenderMode.modes_zh[renderMode]}`;
    player.sendText(text, 5);
  }

  static #sendLoadedStructureForm(player) {
    const form = mc.newSimpleForm();
    form.setTitle("原理图编辑");
    form.setContent("请选择要编辑的原理图: ");
    for (const structName of manager.cache.keys()) {
      form.addButton(structName);
    }
    form.addButton("<<");
    player.sendForm(form, (player, id) => GUI.#loadedStructureFormCallback(player, id));
  }

  static #loadedStructureFormCallback(player, id) {
    if (id === undefined) return;
    if (id === manager.cache.size) {
      GUI.sendMainForm(player);
      return;
    }
    const structName = Array.from(manager.getAllStructureNames())[id];
    GUI.#sendStructureOptionsForm(player, structName);
  }

  static #sendStructureOptionsForm(player, structName) {
    const form = mc.newSimpleForm();
    form.setTitle(`原理图 ${structName} 设置`);
    const originPos = manager.getOriginPos(structName);
    form.setContent(`请选择操作: \n原理图位置: ${HelperUtils.dims[originPos.dimid]} (${originPos.x}, ${originPos.y}, ${originPos.z})`);
    let buttons = ["渲染设置", "材料列表", "定位到玩家"];
    form.addButton("渲染设置").addButton("材料列表").addButton("定位到玩家");
    if (structName !== Wand.getControlingStruct(player)) {
      form.addButton("设置为主控原理图");
      buttons.push("设置为主控");
    }
    form.addButton(manager.isLockedPos(structName) ? "解锁" : "锁定" + "原理图位置");
    buttons.push("锁定原理图");
    if (player.isCreative) {
      form.addButton("创造放置");
      buttons.push("创造放置");
    }
    form.addButton("移除原理图");
    form.addButton("<<");
    buttons.push("移除原理图", "返回");
    player.sendForm(form, (player, id) => GUI.#structureOptionsFormCallback(player, structName, id, buttons));
  }

  static #structureOptionsFormCallback(player, structName, id, buttons) {
    if (id === undefined) return;
    switch (buttons[id]) {
      case "渲染设置":
        GUI.#sendStructureRenderForm(player, structName);
        break;
      case "定位到玩家":
        if (manager.isLockedPos(structName)) {
          player.sendText("§c原理图位置已锁定, 无法移动原理图！", 5);
          return;
        }
        const originPos = manager.getOriginPos(structName);
        originPos.x = Math.floor(player.feetPos.x);
        originPos.y = Math.floor(player.feetPos.y);
        originPos.z = Math.floor(player.feetPos.z);
        originPos.dimid = player.feetPos.dimid;
        Event.trigger(Events.MANAGER_CHANGER_ORIGIN_POS, structName, originPos);
        Event.trigger(Events.MANAGER_UPDATE_DATA);
        player.sendText(`已将原理图移动到 (${originPos.x}, ${originPos.y}, ${originPos.z})`, 5);
        break;
      case "设置为主控":
        Event.trigger(Events.WAND_CHANGE_CONTROLING_STRUCT, player, structName);
        Event.trigger(Events.WAND_CHANGE_MODE, player, WandMode.Placing);
        Event.trigger(Events.WAND_UPDATE_DATA, player);
        player.sendText(`已设置 §l${structName} §r为主控原理图`, 5);
        break;
      case "移除原理图":
        Event.trigger(Events.RENDER_STOP_ALL_RENDERING, player, structName);
        Event.trigger(Events.MANAGER_REMOVE_STRUCTURE, structName);
        Event.trigger(Events.MANAGER_UPDATE_DATA);
        Event.trigger(Events.WAND_CHANGE_CONTROLING_STRUCT, player, null);
        Event.trigger(Events.WAND_UPDATE_DATA, player);
        player.sendText(`原理图 §l${structName} §r已移除`, 5);
        if (manager.cache.size > 0) {
          GUI.#sendLoadedStructureForm(player);
        }
        break;
      case "创造放置":
        Event.trigger(Events.MANAGER_PASTE_STRUCTURE, structName, player);
        break;
      case "材料列表":
        Event.trigger(Events.RENDER_GET_MATERIALS, structName, player);
        break;
      case "锁定原理图":
        Event.trigger(Events.MANAGER_CHANGER_LOCK_POS, structName, !manager.isLockedPos(structName));
        Event.trigger(Events.MANAGER_UPDATE_DATA);
        break;
      case "返回":
        GUI.#sendLoadedStructureForm(player);
        return;
    }
  }

  static #sendStructureRenderForm(player, structName) {
    const form = mc.newCustomForm();
    form.setTitle(`原理图 ${structName} 渲染设置`);
    const currentRenderMode = Render.getMode(structName);
    form.addStepSlider("改变显示模式", RenderMode.modes_zh, currentRenderMode);
    if (currentRenderMode !== RenderMode.All && currentRenderMode !== RenderMode.Off)
      form.addInput("相对层高度",
        Render.getLayerIndex(structName).toString(),
        Render.getLayerIndex(structName).toString());
    form.setSubmitButton("确定");
    player.sendForm(form, (player, data) => GUI.#structureRenderFormCallback(player, data, structName));
  }

  static #structureRenderFormCallback(player, data, structName) {
    if (data === undefined) return;

    const newRenderMode = data[0];
    const oldRenderMode = Render.getMode(structName);
    if (newRenderMode !== oldRenderMode) {
      Event.trigger(Events.RENDER_STOP_ALL_RENDERING);
      Event.trigger(Events.RENDER_SET_RENDER_MODE, newRenderMode, structName);
      Event.trigger(Events.RENDER_UPDATE_DATA);

      if ((oldRenderMode === RenderMode.All || oldRenderMode === RenderMode.Off) &&
        (newRenderMode !== RenderMode.All && newRenderMode !== RenderMode.Off)) {
        GUI.#sendStructureRenderForm(player, structName);
      }
    }

    let newLayerIndex = Number(data[1]); // string --> number
    if (Number.isNaN(newLayerIndex)) return;
    const max = manager.getSize(structName).y;
    if(newLayerIndex > max) newLayerIndex = max;
    if(newLayerIndex < 0) newLayerIndex = 0;
    const oldLayerIndex = Render.getLayerIndex(structName);
    if (newLayerIndex !== oldLayerIndex) {
      Event.trigger(Events.RENDER_SET_LAYER_INDEX, newLayerIndex, structName);
      Event.trigger(Events.RENDER_UPDATE_DATA);
    }
  }
    
  static #sendOptionsForm(player) {
    const form = mc.newCustomForm();
    form.setTitle("ResinClumps 配置");
    const currentRenderMode = Render.getMode();
    form.addStepSlider("改变默认显示模式", RenderMode.modes_zh, currentRenderMode);
    if (currentRenderMode !== RenderMode.All && currentRenderMode !== RenderMode.Off)
      form.addInput(`默认层高度\n定位到玩家: ${Math.floor(player.feetPos.y)}`,
        Render.getLayerIndex().toString(),
        Render.getLayerIndex().toString());
    form.setSubmitButton("确定");
    player.sendForm(form, GUI.#optionsFormCallback);
  }

  static #optionsFormCallback(player, data) {
    if (data === undefined) return;

    const newRenderMode = data[0];
    const oldRenderMode = Render.getMode();
    if (newRenderMode !== oldRenderMode) {
      Event.trigger(Events.RENDER_SET_RENDER_MODE, newRenderMode);
      Event.trigger(Events.RENDER_UPDATE_DATA);

      if ((oldRenderMode === RenderMode.All || oldRenderMode === RenderMode.Off) &&
        (newRenderMode !== RenderMode.All && newRenderMode !== RenderMode.Off)) {
        GUI.#sendOptionsForm(player);
      }
    }

    let newLayerIndex = Number(data[1]); // string --> number
    if (Number.isNaN(newLayerIndex)) return;
    if(newLayerIndex > 319) newLayerIndex = 319;
    if(newLayerIndex < -64) newLayerIndex = -64;
    const oldLayerIndex = Render.getLayerIndex();
    if (newLayerIndex !== oldLayerIndex) {
      Event.trigger(Events.RENDER_SET_LAYER_INDEX, newLayerIndex);
      Event.trigger(Events.RENDER_UPDATE_DATA);
    }
  }

  static sendMaterialsForm(player, results, allCount) {
    const form = mc.newSimpleForm();
    form.setTitle("材料列表");
    let content = "以下是所需材料:";
    results.sort((a, b) => b.count - a.count);
    let currentCount = 0;
    for (const item of results) {
      let count = item.count;
      currentCount += count;
      content += `\n${HelperUtils.trBlock(item.blockName.replace('minecraft:', ''))}§r : ${count}`;
      if (count >= 1728) {
        content += ` = ${Math.floor(count / 1728)} 盒`;
        count = count % 1728;
        if (count >= 64) {
          content += ` + ${Math.floor(count / 64)} 组`;
          count = count % 64;
        } else if (count > 0) {
          content += ` + ${count} 个`;
        }
      } else if (count >= 64) {
        content += ` = ${Math.floor(count / 64)} 组`;
        count = count % 64;
        if (count > 0) {
          content += ` + ${count} 个`;
        }
      }
    }
    content += `\n总计 ${currentCount} / ${allCount} 个方块, 完成度: ${((1 - currentCount / allCount) * 100).toFixed(2)}%%`;  // 两个 % 才能显示一个
    form.setContent(content);
    form.addButton("<<");
    player.sendForm(form, (player, id) => {
      if (id === undefined) return;
      GUI.#sendLoadedStructureForm(player);
    });
  }
}

export function GUIInit() {
  if(typeof Event === 'undefined') throw new Error("Event module is required for GUI module.");
  Event.listen(Events.GUI_SEND_MAIN_FORM, GUI.sendMainForm);
  Event.listen(Events.GUI_SEND_MATERIALS, GUI.sendMaterialsForm.bind(manager));
  // logger.info("GUI module initialized.");
}