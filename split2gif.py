import os
from PIL import Image

# 1. 准备工作
os.makedirs("gif", exist_ok=True)
image_path = "muziki_nobg.png"
# 确保转换为 RGBA 模式以读取透明度
img = Image.open(image_path).convert("RGBA")
width, height = img.size

rows = 7
cols = 7

# 2. 提取透明度通道，利用“像素投影”寻找真正的 X/Y 轴切割线
alpha = img.split()[-1]
# 将像素转化为列表，大幅提升扫描速度
alpha_data = list(alpha.getdata())

# 快速计算 X 和 Y 轴上每一行/列的 Alpha 像素总和
row_sums = [sum(alpha_data[y * width : (y + 1) * width]) for y in range(height)]
col_sums = [sum(alpha_data[y * width + x] for y in range(height)) for x in range(width)]

# 智能寻找边界的函数：在预估位置附近，寻找像素最少的“缝隙”
def find_boundaries(sums, count):
    total_len = len(sums)
    est_size = total_len // count
    boundaries = [0]
    for i in range(1, count):
        search_center = i * est_size
        # 在预估边界的上下/左右浮动范围内寻找
        search_start = max(0, search_center - est_size // 2)
        search_end = min(total_len, search_center + est_size // 2)
        
        window = sums[search_start:search_end]
        # 找到像素总和最小的那一行/列，这就是真正的切割线！
        min_idx = search_start + window.index(min(window))
        boundaries.append(min_idx)
    boundaries.append(total_len)
    return boundaries

row_bounds = find_boundaries(row_sums, rows)
col_bounds = find_boundaries(col_sums, cols)

print("智能识别 Y 轴切割线:", row_bounds)
print("智能识别 X 轴切割线:", col_bounds)

# 3. 按行处理并生成完美对齐的 GIF
for r in range(rows):
    cells = []
    bboxes = []
    
    # 获取这一行的 7 个基础单元格
    for c in range(cols):
        left = col_bounds[c]
        right = col_bounds[c+1]
        top = row_bounds[r]
        bottom = row_bounds[r+1]
        
        cell_img = img.crop((left, top, right, bottom))
        cells.append(cell_img)
        
        # 获取该单元格内实际有效像素的包围盒
        bbox = cell_img.getbbox()
        if bbox:
            bboxes.append(bbox)
    
    if not bboxes:
        continue
        
    # 4. 核心防抖逻辑：计算这一行所有动作的“最大包围盒”
    # 这样能把这一行动作中最长的绳子、伸得最远的手统统包容进来，且中心点不偏移
    min_left = min(b[0] for b in bboxes)
    min_top = min(b[1] for b in bboxes)
    max_right = max(b[2] for b in bboxes)
    max_bottom = max(b[3] for b in bboxes)
    
    # 计算这个统一裁剪框的宽高
    crop_w = max_right - min_left
    crop_h = max_bottom - min_top
    
    # 统一补齐为正方形（QQ 表情包最佳比例，防止导入后被拉伸变形）
    max_side = max(crop_w, crop_h)
    pad_x = (max_side - crop_w) // 2
    pad_y = (max_side - crop_h) // 2
    
    frames = []
    for cell in cells:
        # 每一帧都按统一的最大边界裁剪
        tight_crop = cell.crop((min_left, min_top, max_right, max_bottom))
        
        # 贴到透明正方形画布上
        square_frame = Image.new("RGBA", (max_side, max_side), (0, 0, 0, 0))
        square_frame.paste(tight_crop, (pad_x, pad_y))
        frames.append(square_frame)
        
    # 5. 保存 GIF
    output_filename = f"perfect_row_{r+1}.gif"
    output_path = os.path.join("gif", output_filename)
    frames[0].save(
        output_path, 
        save_all=True, 
        append_images=frames[1:], 
        duration=220, 
        loop=0,
        disposal=2  # 重要：透明背景 GIF 必须设置为 2，防止上一帧的残影残留
    )
    print(f"✨ 完美防抖生成: {output_filename}")