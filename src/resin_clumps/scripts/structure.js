import { Nbt } from "../utils/nbt.js";

export class Structure {
  static load(filePath) {
    if (!File.exists(filePath)) return null;
    const fi = new File(filePath, file.ReadMode, true);
    const nbt = fi.readAllSync();
    fi.close();
    const comp = NBT.parseBinaryNBT(nbt);
    const obj = Nbt.NbtToObject(comp);

    xyz_to_yxz(obj);
    
    keepPaletteNbt(obj, comp);

    // 关键修复: 将根 NBT 对象挂载到 struct 上，防止其被 GC 回收导致子 tag 失效
    // struct.__root_nbt__ = comp;

    // pickleRemoveWater(obj);

    if (!obj?.structure) throw new Error(`Fail to load ${filePath}`);

    // 内存优化: 移除无关数据
    const palette = obj.structure.palette?.default.block_palette;
    if (palette) {
      if (palette) {
        for (let i = 0; i < palette.length; i++) {
          const p = palette[i];
          // 只保留 nbt 数据
          palette[i] = { name: p.name, nbt: p.nbt };
        }
      }
    }

    const struct = {
      size: obj.size,
      block_indices: obj.structure.block_indices[0],
      block_palette: palette
    };

    return struct;
  }

  static save(struct) {
    // TODO
  }
}

function xyz_to_yxz(struct) {
  const size = struct.size;
  const block_indices = struct.structure.block_indices[0];
  const isWaterLogged = struct.structure.block_indices[1];

  // 优化: 使用 TypedArray 代替普通 Array 存储方块索引，能大幅降低内存占用
  const new_block_indices = new Int32Array(block_indices.length);
  const new_isWaterLogged = new Int32Array(isWaterLogged.length);

  let old_index = 0;
  for (let x = 0; x < size[0]; x++) {
    for (let y = 0; y < size[1]; y++) {
      for (let z = 0; z < size[2]; z++) {
        const new_index = y * size[0] * size[2] + x * size[2] + z;
        new_block_indices[new_index] = block_indices[old_index];
        new_isWaterLogged[new_index] = isWaterLogged[old_index];
        old_index++;
      }
    }
  }
  struct.structure.block_indices[0] = new_block_indices;
  struct.structure.block_indices[1] = new_isWaterLogged;
}

// 保留方块调色板中的 NBT 数据, 此功能可能过于超模
function keepPaletteNbt(struct, structNbt) {
  let index = 0;
  for (const obj of struct.structure.palette.default.block_palette) {
    const origNbt = structNbt.getTag('structure')
      .getTag('palette')
      .getTag('default')
      .getTag('block_palette')
      .getTag(index);
    
    // Copilot 推荐的深拷贝方式: 通过 SNBT 转换序列化
    // 这能确保切断所有引用，且能正确处理多层嵌套的 NBT
    obj.nbt = NBT.parseSNBT(origNbt.toSNBT());
    // logger.info(`Keeping NBT for palette index ${index}: ${obj.nbt.toSNBT()}`);
    index++;
  }
}

// 直接为所有海泡菜去水
/*
function pickleRemoveWater(struct) {
  for (const obj of struct.structure.palette.default.block_palette) {
    if (obj.name === "minecraft:sea_pickle") {
      if (obj.states?.dead_bit !== undefined) {
        obj.states.dead_bit = true;
      }
    }
  }
}*/