import "../core/event.js";
import { ManagerInit } from "../core/manager.js";
import { RenderInit } from "../render/index.js";
import { WandInit } from "../core/wand.js";
import { GUIInit } from "../ui/gui.js";
import { Command } from "../ui/command.js";
import { EasyPlaceInit } from "../scripts/easyplace.js";
import { ContainerInit } from "../scripts/container.js";

export function Initialize() {

  Command.register();

  ManagerInit();
  RenderInit();
  WandInit();
  GUIInit();
  EasyPlaceInit();
  ContainerInit();
  
  logger.info("ResinClumps initialized.");
}
