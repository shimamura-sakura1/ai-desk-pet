import os
import argparse
import shutil
import re

def main():
    # 1. 初始化解析器
    parser = argparse.ArgumentParser(
        description="【桌面宠物工具】根据行号将切分后的雪碧图(Sprite)帧划分到对应的状态文件夹中"
    )
    
    # 基础参数
    parser.add_argument("-i", "--input", required=True, help="输入切分后的帧图片所在的文件夹")
    parser.add_argument("-o", "--output", default=None, help="输出文件的位置（默认在输入目录下新建 clips 文件夹）")
    
    # 核心：动态状态分配参数
    # 用户可以输入：-s idle=1 bored=2,3 working=4 custom_status=5
    parser.add_argument(
        "-s", "--status",
        nargs="+",
        required=True,
        help="状态分配列表，格式为 '状态名=行号'。多个行号用逗号隔开。例如：-s idle=1 bored=2,3 my_live=4"
    )

    args = parser.parse_args()
    input_dir = args.input
    
    if not os.path.isdir(input_dir):
        print(f"❌ 错误：输入路径不是一个有效的文件夹: {input_dir}")
        return

    # 2. 解析动态状态映射 (MAP)
    # 将用户输入的 ["idle=1", "bored=2,3"] 解析为 {"idle": [1], "bored": [2, 3]}
    status_map = {}
    for item in args.status:
        if "=" not in item:
            print(f"⚠️ 警告：无法解析参数 '{item}'，必须符合 '状态名=行号' 的格式（如 idle=1）")
            continue
        status_name, rows_str = item.split("=", 1)
        try:
            # 允许用户输入 "2,3" 这种多行对应同一状态的情况
            rows_list = [int(r.strip()) for r in rows_str.split(",") if r.strip()]
            status_map[status_name.strip()] = rows_list
        except ValueError:
            print(f"❌ 错误：状态 '{status_name}' 对应的行号 '{rows_str}' 不是有效的整数！")
            return

    # 3. 智能计算默认输出路径
    if args.output is None:
        # 使用 os.path 安全处理路径
        parent_dir = os.path.dirname(os.path.abspath(input_dir))
        base_name = os.path.basename(os.path.abspath(input_dir))
        output_dir = os.path.join(parent_dir, base_name, "clips")
    else:
        output_dir = args.output

    # 4. 读取并对输入的 PNG 文件进行精准“按行归类”
    # 提取所有含有 row_X_frame_Y 结构的 png 文件
    all_files = os.listdir(input_dir)
    row_frames_map = {} # 数据结构：{ 行号: [文件路径1, 文件路径2, ...] }
    
    # 使用正则表达式精准匹配行号，防止因 os.listdir 乱序导致分组失败
    pattern = re.compile(r"row_(\d+)_frame_\d+\.png")
    
    for file in all_files:
        match = pattern.search(file)
        if match:
            row_num = int(match.group(1)) # 提取出纯数字行号
            full_path = os.path.join(input_dir, file)
            if row_num not in row_frames_map:
                row_frames_map[row_num] = []
            row_frames_map[row_num].append(full_path)

    if not row_frames_map:
        print(f"❌ 错误：在文件夹 '{input_dir}' 中没有找到符合 'row_X_frame_Y.png' 命名规则的图片。")
        return

    # 5. 开始创建文件夹并安全复制
    print("\n🚀 开始按状态分发动作帧...")
    
    for status, rows in status_map.items():
        num_groups = len(rows)
        
        for i, row_index in enumerate(rows):
            # 判断目标文件夹名字：如果该状态只有一组，就不加后缀；有多组则加 -1, -2
            if num_groups == 1:
                target_dir_name = status
            else:
                target_dir_name = f"{status}-{i+1}"
                
            target_dir = os.path.join(output_dir, target_dir_name)
            
            # 检查源行号图片是否存在
            if row_index not in row_frames_map:
                print(f"⚠️ 警告：状态 '{status}' 绑定的第 {row_index} 行在输入文件夹中不存在，已跳过。")
                continue
                
            # 确保创建目标文件夹
            os.makedirs(target_dir, exist_ok=True)
            
            # 复制该行的所有帧
            for src_png in row_frames_map[row_index]:
                shutil.copy(src_png, target_dir)
                
            print(f"  └─ 行 {row_index} ──> 成功复制到文件夹: [{target_dir_name}]")

    print(f"\n🎉 全部完成！所有 Sprite 动作集已成功输出至: {output_dir}")

if __name__ == "__main__":
    main()