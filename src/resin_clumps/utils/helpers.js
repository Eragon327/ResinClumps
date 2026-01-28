export class HelperUtils {  // 全静态类
  static #threshold = 0.5;
  static toBaseDirection(direction) {
    const yawRad = direction.yaw * (Math.PI / 180);
    const pitchRad = direction.pitch * (Math.PI / 180);

    const sinYaw = Math.sin(yawRad);
    const cosYaw = Math.cos(yawRad);
    const sinPitch = Math.sin(pitchRad);
    const cosPitch = Math.cos(pitchRad);

    const d = {
      x: -cosPitch * sinYaw,
      y: -sinPitch,
      z: cosPitch * cosYaw
    };

    const result = { x: 0, y: 0, z: 0 };

    const max_abs = Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
    if (max_abs < HelperUtils.#threshold) {
      return result;
    }

    if (Math.abs(d.y) > Math.abs(d.x) && Math.abs(d.y) > Math.abs(d.z)) {
      if (d.y > 0) {
        result.y = 1;
      } else {
        result.y = -1;
      }
    } else if (Math.abs(d.x) > Math.abs(d.z)) {
      if (d.x > 0) {
        result.x = 1;
      } else {
        result.x = -1;
      }
    } else {
      if (d.z > 0) {
        result.z = 1;
      } else {
        result.z = -1;
      }
    }
    return result;
  }

  static ObjectEquals(obj1, obj2) {
    for (const key in obj1) {
      if (typeof obj1[key] !== typeof obj2[key]) return false;
      if (typeof obj1[key] === 'object') {
        if (Array.isArray(obj1[key]) !== Array.isArray(obj2[key])) return false;
        if (Array.isArray(obj1[key])) {
          if (obj1[key].length !== obj2[key].length) return false;
          for (let i = 0; i < obj1[key].length; i++) {
            if (typeof obj1[key][i] !== typeof obj2[key][i]) return false;
            if (typeof obj1[key][i] === 'object') {
              return HelperUtils.ObjectEquals(obj1[key][i], obj2[key][i]);
            } else {
              if (obj1[key][i] !== obj2[key][i]) return false;
            }
          }
        } else {
          return HelperUtils.ObjectEquals(obj1[key], obj2[key]);
        }
      } else {
        if (obj1[key] !== obj2[key]) return false;
      }
    }
    return true;
  }

  static trueToOne(obj) {
    obj = JSON.parse(JSON.stringify(obj)); // 深拷贝

    for (const key in obj) {
      if (obj[key] === true) {
        obj[key] = 1;
      } else if (obj[key] === false) {
        obj[key] = 0;
      }
    }

    return obj;
  }

  static countOnes(n) {
    return n.toString(2).split('1').length - 1;
  }

  static #en_ = [
    "one",
    "two",
    "three",
    "four"
  ]
  static enToNumber(numStr) {
    if (typeof numStr !== 'string') return NaN;
    const en = numStr.split('_')[0];
    const index = HelperUtils.#en_.indexOf(en);
    if (index === -1) return NaN;
    return index + 1;
  }

  static dims = ['主世界', '下界', '末地'];

  static trBlocks(results, content, currentCount, allCount) {// 全物品 ≈0.01s
    if (!File.exists("./plugins/ResinClumps/src/lang/zh_CN.json")) {//使用blockName
      logger.error("./plugins/ResinClumps/src/lang/zh_CN.json翻译文件缺失,使用blockName");

      for (const item of results) {// 我不想再抽象一层
        let count = item.count;
        currentCount += count;
        content += `\n${item.blockName} : ${count}`;
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
    } else {
      const zh_CN2 = new JsonConfigFile("./plugins/ResinClumps/src/lang/zh_CN.json", '{}');

      for (const item of results) {
        let count = item.count;
        currentCount += count;
        content += `\n${zh_CN2.get(item.blockName)} : ${count}`;
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

      zh_CN2.close();
    }

    content += `\n总计 ${currentCount} / ${allCount} 个方块, 完成度: ${((1 - currentCount / allCount) * 100).toFixed(2)}%%`;  // 两个 % 才能显示一个
    return content;
  }

  static simplifyBlockName(enName) {
    // 去除方块名称中的前缀
    let simpleName = enName;
    const directionSuffixes = [
      'unlit_', // 长的放在前面避免漏删
      'lit_',
      'unpowered_',
      'powered_',
      'minecraft:'
    ];
    for (const suffix of directionSuffixes) {
      simpleName = simpleName.replace(suffix, '');
    }
    return simpleName;
  }
}