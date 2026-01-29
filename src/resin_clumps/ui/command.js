import { Event, Events } from "../core/event.js";
import { manager } from "../core/manager.js";
import { Wand, WandMode } from "../core/wand.js";
import { HelperUtils } from "../utils/helpers.js";

export class Command {
  static register() {
    const resinclumps = mc.newCommand('resinclumps', 'ResinClumps Info', PermType.Any);

    resinclumps.overload();

    resinclumps.setCallback(this.#resinclumpsCommand);
    resinclumps.setup();

    const rc = mc.newCommand('rc', 'ResinClumps Command', PermType.Any);
    
    // 打开主界面
    rc.overload([]);

    // 加载原理图
    rc.setEnum("load", ["load"]);
    rc.setEnum("dim", ["overworld", "nether", "the_end"])
    rc.mandatory("loadAction", ParamType.Enum, "load");
    rc.mandatory("structToLoad", ParamType.String);
    rc.optional("originPos", ParamType.BlockPos);
    rc.optional("Dim", ParamType.Enum, "dim")
    rc.overload(["loadAction", "structToLoad", "originPos", "Dim"]);

    // 卸载原理图
    rc.setEnum("unload", ["unload"]);
    rc.mandatory("unloadAction", ParamType.Enum, "unload");
    rc.mandatory("structToUnload", ParamType.String);
    rc.overload(["unloadAction", "structToUnload"]);

    // 刷新渲染
    rc.setEnum("refresh", ["refresh"]);
    rc.mandatory("refreshAction", ParamType.Enum, "refresh");
    rc.optional("structToRefresh", ParamType.String);
    rc.overload(["refreshAction", "structToRefresh"]);

    rc.setCallback(this.#rcCommand);
    rc.setup();
  }

  static #resinclumpsCommand(_cmd, _origin, output, _result) {
    const configFile = new JsonConfigFile("./plugins/ResinClumps/manifest.json", '{}');
    const version = configFile.get('version', 'unknown');
    configFile.close();
    output.success(`ResinClumps 插件 版本: ${version}`);
  }

  static #rcCommand(_cmd, origin, output, result) {
    result = Object.values(result);
    if (!result.length) {
      if (origin.player) {
        const player = origin.player;
        setTimeout(() => { Event.trigger(Events.GUI_SEND_MAIN_FORM, player); }, 1);
      }
    } else {
      try {
        switch (result[0]) {
          // 加载原理图
          case "load": {
            const name = result[1];
            if (!manager.getAllFileStructureNames().includes(name)) {
              output.error(`结构文件 ${name}.mcstructure 不存在`);
              return;
            }

            const player = origin.player;

            let originPos = null;

            if (result[2] && result[3])
              originPos = new IntPos(result[2].x, result[2].y, result[2].z, HelperUtils.dims.indexOf(result[3]));
            else if (player)
              originPos = new IntPos(Math.floor(player.feetPos.x), Math.floor(player.feetPos.y), Math.floor(player.feetPos.z), player.feetPos.dimid);
            else output.error('非玩家必须输入坐标')
          
            let structName = result[1];
            let count = 1;
            while (manager.hasStructure(structName)) {
              structName = `${result[1]}_${count}`;
              count++;
            }
          
            try {
              Event.trigger(Events.MANAGER_ADD_STRUCTURE, `./plugins/ResinClumps/structure/${result[1]}.mcstructure`, originPos, structName);
              Event.trigger(Events.MANAGER_UPDATE_DATA);
              // Event.trigger(Events.RENDER_UPDATE_DATA);
              if (player) {
                Event.trigger(Events.WAND_ADD_PLAYER, player);
                Event.trigger(Events.WAND_CHANGE_MODE, player, WandMode.Placing);
                Event.trigger(Events.WAND_CHANGE_CONTROLING_STRUCT, player, structName);
                Event.trigger(Events.WAND_UPDATE_DATA, player);
              }
              Event.trigger(Events.RENDER_REFRESH_GRIDS, structName);
            } catch (e) {
              if (player)
                player.sendText(`§c加载原理图 §l${result[1]} §r§c失败`, 5);
              logger.error(`Failed to load structure ${result[1]}: ${e.message}`);
              return;
            }
            let text = `原理图 §l${result[1]} §r已加载`;
            if (count > 1) text += ` 为 §l${structName}§r`;
            if (player) player.sendText(text, 5);
            break;
          }
          // 卸载原理图
          case "unload": {
            const player = origin.player;
            const structNameToUnload = result[1];
            if (!manager.hasStructure(structNameToUnload)) {
              output.error(`结构 ${structNameToUnload} 不存在`);
              return;
            } else {
              Event.trigger(Events.RENDER_STOP_ALL_RENDERING, player, structNameToUnload);
              Event.trigger(Events.MANAGER_REMOVE_STRUCTURE, structNameToUnload);
              Event.trigger(Events.MANAGER_UPDATE_DATA);
              if (Wand.getControlingStruct(player) === structNameToUnload)
                Event.trigger(Events.WAND_CHANGE_CONTROLING_STRUCT, player, null);
              Event.trigger(Events.WAND_UPDATE_DATA, player);
              Event.trigger(Events.RENDER_REFRESH_GRIDS, structNameToUnload);
              player.sendText(`原理图 §l${structNameToUnload} §r已移除`, 5);
            }
            break;
          }
          // 刷新渲染
          case "refresh": {
            if (result[1]) {
              if (manager.hasStructure(result[1])) {
                Event.trigger(Events.RENDER_REFRESH_GRIDS, result[1]);
                output.success(`已刷新结构 ${result[1]} 的渲染`);
              } else {
                output.error(`结构 ${result[1]} 不存在`);
              }
            } else {
              Event.trigger(Events.RENDER_REFRESH_GRIDS);
              output.success("已刷新所有结构的渲染");
            }
            break;
          }
          default:
            logger.error(`Unknown Command: rc ${Array.from(result).join(' ')}`);
            output.error('未知的命令, 已打印到控制台');
            break;
        }
      } catch (e) {
        logger.error(`Error executing command rc ${Array.from(result).join(' ')}: ${e.message}`);
        output.error('执行命令时发生错误, 已打印到控制台');
      }
    }
  }
}