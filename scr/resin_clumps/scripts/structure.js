export class Structure {
  static load(filePath) {
    if (!File.exists(filePath)) return null;
    const fi = new File(filePath, file.ReadMode, true);
    const nbt = fi.readAllSync();
    fi.close();
    const comp = NBT.parseBinaryNBT(nbt);
    const struct = JSON.parse(comp.toString()); // 旧版本 LSE 的 toObject() 有 Bug
    // const struct = comp.toObject();          // 新版本 LSE 的 toObject() 已修复该 Bug

    // 内存优化: 移除无关数据
    if (struct.structure) {
        delete struct.structure.entities; 
        const palette = struct.structure.palette?.default;
        if (palette) {
             delete palette.block_position_data; 
             if (palette.block_palette) {
                 for (let i = 0; i < palette.block_palette.length; i++) {
                     const p = palette.block_palette[i];
                     // 只保留 name 和 states, 丢弃 version
                     palette.block_palette[i] = { name: p.name, states: p.states || {} };
                 }
             }
        }
    }

    xyz_to_yxz(struct);
    // keepPaletteNbt(struct, comp); // 已弃用该功能
    pickleRemoveWater(struct);
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

// 保留方块调色板中的 NBT 数据, 此功能可能过于超模, 已弃用
function keepPaletteNbt(struct, structNbt) {
  let index = 0;
  for (const obj of struct.structure.palette.default.block_palette) {
    const origNbt = structNbt.getTag('structure')
      .getTag('palette')
      .getTag('default')
      .getTag('block_palette')
      .getTag(index);
    obj.nbt = origNbt;
    index++;
  }
}

// 直接为所有海泡菜去水
function pickleRemoveWater(struct) {
  for (const obj of struct.structure.palette.default.block_palette) {
    if (obj.name === "minecraft:sea_pickle") {
      if (obj.states?.dead_bit !== undefined) {
        obj.states.dead_bit = true;
      }
    }
  }
}