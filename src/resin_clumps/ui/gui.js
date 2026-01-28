import { Event, Events } from "../core/event.js";
import { Wand, WandMode } from "../core/wand.js";
import { manager } from "../core/manager.js";
import { Render, RenderMode } from "../render/index.js";
import { HelperUtils } from "../utils/helpers.js";
import { EasyPlace, PlaceMode } from "../scripts/easyplace.js";

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
    setTimeout(() => {
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
    }, 1);  // 延时执行以防止表单嵌套导致的问题
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
      setTimeout(() => { GUI.sendMainForm(player); }, 1);
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
      Event.trigger(Events.RENDER_REFRESH_GRIDS, structName);
    } catch (e) {
      player.sendText(`§c加载原理图 §l${name} §r§c失败`, 5);
      logger.error(`Failed to load structure ${name}: ${e.message}`);
      return;
    }
    let text = `原理图 §l${name} §r已加载`;
    if (count > 1) text += ` 为 §l${structName}§r`;
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
      setTimeout(() => { GUI.sendMainForm(player); }, 1);
      return;
    }
    const structName = Array.from(manager.getAllStructureNames())[id];
    setTimeout(() => { GUI.#sendStructureOptionsForm(player, structName); }, 1);
  }

  static #sendStructureOptionsForm(player, structName) {
    const form = mc.newSimpleForm();
    form.setTitle(`原理图 ${structName} 设置`);
    const originPos = manager.getOriginPos(structName);
    form.setContent(`请选择操作: \n原理图位置: ${HelperUtils.dims[originPos.dimid]} (${originPos.x}, ${originPos.y}, ${originPos.z})`);
    let buttons = ["渲染设置"];
    form.addButton("渲染设置");
    const mode = Render.getMode(structName);
    if (mode !== RenderMode.Off) {
      form.addButton("材料列表");
      buttons.push("材料列表");
    }
    if (Render.getMode(structName) !== RenderMode.All && Render.getMode(structName) !== RenderMode.Off) {
      form.addButton("材料列表(全部)");
      buttons.push("材料列表全部");
    }
    form.addButton("定位到玩家");
    buttons.push("定位到玩家");
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
        setTimeout(() => { GUI.#sendStructureRenderForm(player, structName); }, 1);
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
        Event.trigger(Events.RENDER_REFRESH_GRIDS, structName);
        player.sendText(`已将原理图移动到 (${originPos.x}, ${originPos.y}, ${originPos.z})`, 5);
        break;
      case "设置为主控":
        Event.trigger(Events.WAND_CHANGE_CONTROLING_STRUCT, player, structName);
        Event.trigger(Events.WAND_UPDATE_DATA, player);
        player.sendText(`已设置 §l${structName} §r为主控原理图`, 5);
        break;
      case "移除原理图":
        Event.trigger(Events.RENDER_STOP_ALL_RENDERING, player, structName);
        Event.trigger(Events.MANAGER_REMOVE_STRUCTURE, structName);
        Event.trigger(Events.MANAGER_UPDATE_DATA);
        if (Wand.getControlingStruct(player) === structName)
          Event.trigger(Events.WAND_CHANGE_CONTROLING_STRUCT, player, null);
        Event.trigger(Events.WAND_UPDATE_DATA, player);
        Event.trigger(Events.RENDER_REFRESH_GRIDS, structName);
        player.sendText(`原理图 §l${structName} §r已移除`, 5);
        if (manager.cache.size > 0) {
          setTimeout(() => { GUI.#sendLoadedStructureForm(player); }, 1);
        }
        break;
      case "创造放置":
        Event.trigger(Events.MANAGER_PASTE_STRUCTURE, structName, player);
        // setTimeout(() => Event.trigger(Events.RENDER_REFRESH_GRIDS, structName), 1); // 放在 paste 函数里触发
        break;
      case "材料列表":
        Event.trigger(Events.RENDER_GET_MATERIALS, structName, player);
        break;
      case "材料列表全部":
        Event.trigger(Events.RENDER_GET_MATERIALS, structName, player, RenderMode.All);
        break;
      case "锁定原理图":
        Event.trigger(Events.MANAGER_CHANGER_LOCK_POS, structName, !manager.isLockedPos(structName));
        Event.trigger(Events.MANAGER_UPDATE_DATA);
        break;
      case "返回":
        setTimeout(() => { GUI.#sendLoadedStructureForm(player); }, 1);
        return;
    }
  }

  static #sendStructureRenderForm(player, structName) {
    const form = mc.newCustomForm();
    form.setTitle(`原理图 ${structName} 渲染设置`);
    const currentRenderMode = Render.getMode(structName);
    form.addStepSlider("改变显示模式", RenderMode.modes_zh, currentRenderMode);
    if (currentRenderMode !== RenderMode.All && currentRenderMode !== RenderMode.Off) {
      const oldLayerIndex = (Render.getLayerIndex(structName) + 1).toString(); // 显示给用户时高度 +1
      const toPlayer = Math.floor(player.feetPos.y) - manager.getOriginPos(structName).y + 1;
      form.addInput(`相对层高度 (定位到玩家: ${toPlayer})`,
        oldLayerIndex,
        oldLayerIndex);
    }
    form.setSubmitButton("确定");
    player.sendForm(form, (player, data) => GUI.#structureRenderFormCallback(player, data, structName));
  }

  static #structureRenderFormCallback(player, data, structName) {
    if (data === undefined) return;

    const newRenderMode = data[0];
    const oldRenderMode = Render.getMode(structName);
    let modeChanged = false;
    if (newRenderMode !== oldRenderMode) {
      Event.trigger(Events.RENDER_STOP_ALL_RENDERING);
      Event.trigger(Events.RENDER_SET_RENDER_MODE, newRenderMode, structName);
      Event.trigger(Events.RENDER_UPDATE_DATA);

      modeChanged = true;
      if (newRenderMode !== RenderMode.All && newRenderMode !== RenderMode.Off) {
        setTimeout(() => { GUI.#sendStructureRenderForm(player, structName); }, 1);
      }
    }

    let newLayerIndex = Number(data[1]) - 1; // string --> number --> 显示给用户时高度 +1, 所以这里要 -1
    if (data[1] !== null && Number.isNaN(newLayerIndex)) return;
    const max = manager.getSize(structName).y;
    if(newLayerIndex > max) newLayerIndex = max;
    if(newLayerIndex < 0) newLayerIndex = 0;
    const oldLayerIndex = Render.getLayerIndex(structName);
    let layerChanged = false;
    if (newLayerIndex !== oldLayerIndex) {
      Event.trigger(Events.RENDER_SET_LAYER_INDEX, newLayerIndex, structName);
      Event.trigger(Events.RENDER_UPDATE_DATA);
      layerChanged = true;
    }

    Event.trigger(Events.RENDER_REFRESH_GRIDS, structName);
  }
    
  static #sendOptionsForm(player) {
    const form = mc.newSimpleForm();
    form.setTitle("ResinClumps 配置");
    form.setContent("请选择要配置的选项: ");
    form.addButton("轻松放置设置");
    form.addButton("<<");
    player.sendForm(form, GUI.#optionsFormCallback);
  }

  static #optionsFormCallback(player, id) {
    if (id === undefined) return;
    switch (id) {
      case 0:
        setTimeout(() => { GUI.#sendEasyPlaceOptionsForm(player); }, 1);
        break;
      case 1:
        setTimeout(() => { GUI.sendMainForm(player); }, 1);
        break;
    }
  }

  static #sendEasyPlaceOptionsForm(player) {
    const form = mc.newCustomForm();
    form.setTitle("轻松放置 设置");
    form.addStepSlider("放置模式", PlaceMode.modes_zh, EasyPlace.placeMode);
    form.setSubmitButton("确定");
    player.sendForm(form, GUI.#easyPlaceOptionsFormCallback);
  }

  static #easyPlaceOptionsFormCallback(_player, data) {
    if (data === undefined) return;
    const newMode = data[0];
    Event.trigger(Events.EASYPLACE_CHANGE_PLACE_MODE, newMode)
  }

  static sendMaterialsForm(player, structName, results, allCount) {
    const form = mc.newSimpleForm();
    form.setTitle("材料列表");
    let content = `以下是原理图 ${structName} 所需材料:`;
    results.sort((a, b) => b.count - a.count);

    let currentCount = 0;

    content += HelperUtils.trBlocks(results,content,currentCount,allCount)

    form.setContent(content);
    form.addButton("复制到剪贴板");
    player.sendForm(form, (player, id) => {
      if (id === undefined) return;
      if (id === 0) {
        setTimeout(() => { GUI.sendMaterialsCopyForm(player, structName, content); }, 1);
      }
    });
  }

  static sendMaterialsCopyForm(player, structName, content) {
    const form = mc.newCustomForm();
    form.setTitle("材料列表");
    form.addInput("请手动复制以下内容到剪贴板:", "", content);
    form.setSubmitButton("<<");
    player.sendForm(form, () => {
      setTimeout(() => { GUI.#sendStructureOptionsForm(player, structName); }, 1);
    });
  }
}

export function GUIInit() {
  if(typeof Event === 'undefined') throw new Error("Event module is required for GUI module.");
  Event.listen(Events.GUI_SEND_MAIN_FORM, GUI.sendMainForm);
  Event.listen(Events.GUI_SEND_MATERIALS, GUI.sendMaterialsForm.bind(manager));
  // logger.info("GUI module initialized.");
}