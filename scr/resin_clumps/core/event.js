class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  listen(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  trigger(event, ...args) {
    // logger.info(`Event triggered: ${event}`);
    if (this.listeners.has(event)) {
      for (const listener of this.listeners.get(event)) {
        listener(...args);
      }
    }
  }

  unlisten(event, listener) {
    if (this.listeners.has(event)) {
      const listeners = this.listeners.get(event);
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }
}

export const Events = Object.freeze({
  MANAGER_ADD_STRUCTURE:          "manager:addStructure",
  MANAGER_REMOVE_STRUCTURE:       "manager:removeStructure",
  MANAGER_UPDATE_DATA:            "manager:updateData",
  MANAGER_UPDATE_STRUCT_LIST:     "manager:updateStructList",
  MANAGER_CHANGER_ORIGIN_POS:     "manager:changerOriginPos",
  MANAGER_CHANGER_LOCK_POS:       "manager:changerLockPos",
  // MANAGER_GET_MATERIALS:          "manager:getMaterials",
  MANAGER_PASTE_STRUCTURE:        "manager:pasteStructure",

  WAND_ADD_PLAYER:                "wand:addPlayer",
  WAND_REMOVE_PLAYER:             "wand:removePlayer",
  WAND_CHANGE_MODE:               "wand:changeMode",
  WAND_CHANGE_CONTROLING_STRUCT:  "wand:changeControlingStruct",
  WAND_UPDATE_DATA:               "wand:updateData",
  // WAND_SHOW_MESSAGE:             "wand:showMessage",

  RENDER_SET_LAYER_INDEX:         "render:setLayerIndex",
  RENDER_SET_RENDER_MODE:         "render:setRenderMode",
  RENDER_UPDATE_DATA:             "render:updateData",
  RENDER_GET_MATERIALS:           "render:getMaterials",
  RENDER_CHECK:                   "render:check",
  RENDER_STOP_ALL_RENDERING:      "render:stopAllRendering",
  RENDER_REFRESH_GRIDS:           "render:refreshGrids",

  CONTAINER_REMOVE_BLOCK_ITEM:    "container:removeBlockItem",

  GUI_SEND_MAIN_FORM:             "gui:sendMainForm",
  GUI_SEND_MATERIALS:             "gui:sendMaterials",
  
  EASYPLACE_CHANGE_PLACE_MODE:    "easyplace:changePlaceMode",
});

export const Event = new EventBus();