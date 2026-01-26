export class Nbt {  // 全静态类
  static ObjectToNbt(obj) {
    const nbtObj = {};
    for (const [key, val] of Object.entries(obj)) {
      switch (typeof val) {
        case 'number':
          if (Number.isInteger(val)) {
            nbtObj[key] = new NbtInt(val);
          } else {
            nbtObj[key] = new NbtFloat(val);
          }
          break;
        case 'string':
          nbtObj[key] = new NbtString(val);
          break;
        case 'boolean':
          nbtObj[key] = new NbtByte(val ? 1 : 0);
          break;
        case 'object':
          if (Array.isArray(val)) {
            nbtObj[key] = Nbt.ArrayToNbt(val);
          } else {
            nbtObj[key] = Nbt.ObjectToNbt(val);
          }
          break;
      }
    }
    return new NbtCompound(nbtObj);
  }
      
  static ArrayToNbt(arr) {
    const nbtArr = arr.map((val) => {
      switch (typeof val) {
        case 'number':
          if (Number.isInteger(val)) {
            nbtObj[key] = new NbtInt(val);
          } else {
            nbtObj[key] = new NbtFloat(val);
          }
          break;
        case 'string':
          return new NbtString(val);
        case 'boolean':
          return new NbtByte(val ? 1 : 0);
        case 'object':
          if (Array.isArray(val)) {
            return Nbt.ArrayToNbt(val);
          } else {
            return Nbt.ObjectToNbt(val);
          }
      }
    });
    return new NbtList(nbtArr);
  }
}
