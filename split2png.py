import os
import argparse
from PIL import Image

def main():
    # =================================================================
    # 1. 配置命令行参数解析
    # =================================================================
    parser = argparse.ArgumentParser(description="智能雪碧图（Sprite Sheet）防抖切割工具")
    
    # 必填参数：输入图片路径
    parser.add_argument(
        "-i", "--input", 
        required=True, 
        help="输入的雪碧图(Sprite Sheet)文件路径，例如: /path/to/character.png"
    )
    
    # 可选参数：输出目录（如果不填，默认为输入文件同级目录下、以文件名命名的文件夹）
    parser.add_argument(
        "-o", "--output", 
        default=None, 
        help="输出文件夹路径（默认在输入文件同级目录下创建同名文件夹）"
    )
    
    # 可选参数：行列数（默认 7x7，方便以后复用）
    parser.add_argument("--rows", type=int, default=7, help="雪碧图的行数 (默认: 7)")
    parser.add_argument("--cols", type=int, default=7, help="雪碧图的列数 (默认: 7)")

    args = parser.parse_args()

    # =================================================================
    # 2. 动态计算输入与输出路径
    # =================================================================
    image_path = args.input
    rows = args.rows
    cols = args.cols

    # 检查输入文件是否存在
    if not os.path.exists(image_path):
        print(f"❌ 错误：找不到输入文件 '{image_path}'")
        return

    # 如果用户没有指定输出目录，则自动生成
    if args.output is None:
        # 拆分路径，例如: "/path/to/character.png" -> "/path/to", "character.png"
        input_dir, input_filename = os.path.split(image_path)
        # 获取不带后缀的文件名，例如: "character"
        file_base_name, _ = os.path.splitext(input_filename)
        # 拼接默认输出路径: "/path/to/character"
        output_dir = os.path.join(input_dir, file_base_name)
    else:
        output_dir = args.output

    # 创建输出文件夹
    os.makedirs(output_dir, exist_ok=True)
    print(f"📂 输入文件: {image_path}")
    print(f"📂 输出目录: {output_dir}")

    # =================================================================
    # 3. 核心图像处理逻辑 (保持原有逻辑)
    # =================================================================
    # 确保转换为 RGBA 模式以读取透明度
    img = Image.open(image_path).convert("RGBA")
    width, height = img.size

    # 提取透明度通道，利用“像素投影”寻找真正的 X/Y 轴切割线
    alpha = img.split()[-1]
    alpha_data = list(alpha.getdata())

    row_sums = [sum(alpha_data[y * width : (y + 1) * width]) for y in range(height)]
    col_sums = [sum(alpha_data[y * width + x] for y in range(height)) for x in range(width)]

    def find_boundaries(sums, count):
        total_len = len(sums)
        est_size = total_len // count
        boundaries = [0]
        for i in range(1, count):
            search_center = i * est_size
            search_start = max(0, search_center - est_size // 2)
            search_end = min(total_len, search_center + est_size // 2)
            window = sums[search_start:search_end]
            min_idx = search_start + window.index(min(window))
            boundaries.append(min_idx)
        boundaries.append(total_len)
        return boundaries

    row_bounds = find_boundaries(row_sums, rows)
    col_bounds = find_boundaries(col_sums, cols)

    print("智能识别 Y 轴切割线:", row_bounds)
    print("智能识别 X 轴切割线:", col_bounds)

    # 按行处理并生成完美对齐的单帧图片
    for r in range(rows):
        cells = []
        bboxes = []
        
        for c in range(cols):
            left = col_bounds[c]
            right = col_bounds[c+1]
            top = row_bounds[r]
            bottom = row_bounds[r+1]
            
            cell_img = img.crop((left, top, right, bottom))
            cells.append(cell_img)
            
            bbox = cell_img.getbbox()
            if bbox:
                bboxes.append(bbox)
        
        if not bboxes:
            continue
            
        # 核心防抖逻辑：计算这一行所有动作的“最大包围盒”
        min_left = min(b[0] for b in bboxes)
        min_top = min(b[1] for b in bboxes)
        max_right = max(b[2] for b in bboxes)
        max_bottom = max(b[3] for b in bboxes)
        
        crop_w = max_right - min_left
        crop_h = max_bottom - min_top
        
        max_side = max(crop_w, crop_h)
        pad_x = (max_side - crop_w) // 2
        pad_y = (max_side - crop_h) // 2
        
        # 遍历这一行的每个单元格，独立保存为 PNG
        for c, cell in enumerate(cells):
            tight_crop = cell.crop((min_left, min_top, max_right, max_bottom))
            
            # 贴到透明正方形画布上（保证同一行的每一帧尺寸绝对一致）
            square_frame = Image.new("RGBA", (max_side, max_side), (0, 0, 0, 0))
            square_frame.paste(tight_crop, (pad_x, pad_y))
            
            # 命名格式为：row_1_frame_1.png 到 row_7_frame_7.png
            output_filename = f"row_{r+1}_frame_{c+1}.png"
            output_path = os.path.join(output_dir, output_filename)
            square_frame.save(output_path, format="PNG")
            
        print(f"✨ 第 {r+1} 行的 {cols} 张独立帧已生成")

    print(f"🎉 全部图片已完美切割并保存在 '{output_dir}' 文件夹中！")

if __name__ == "__main__":
    main()