import { Event, Events } from "../core/event.js";

export class Command {
  static register() {
    const cmd = mc.newCommand('litematica', 'Litematica commands', PermType.Any);

    cmd.overload();

    cmd.setCallback(this.#onCommand);

    cmd.setup();
  }

  static #onCommand(_cmd, origin, _output, result) {
    if (!result.length) {
      if (origin.player) {
        Event.trigger(Events.GUI_SEND_MAIN_FORM, origin.player);
      }
    } else {
      switch (result[0]) {
      }
    }
  }
}