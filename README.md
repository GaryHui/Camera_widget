# Jotform 九张指定角度拍照证明组件

这是一个独立的 Jotform Custom Widget，不依赖现有项目，也不需要 React/Vue/打包工具。把整个目录部署到 HTTPS 静态站点后，将 `index.html` 的公网地址配置到 Jotform 自定义组件即可。

## 文件

- `index.html`：组件页面
- `styles.css`：组件样式
- `widget.js`：摄像头、定位、水印、Jotform 通信逻辑

## 能力

- 只调用摄像头拍照，不提供文件上传入口
- 优先调用后置摄像头
- 请求高精度定位
- 要求依次拍摄 9 张指定照片：
  - 车身左前 45 度
  - 车身右前 45 度
  - 车身左后 45 度
  - 车身右后 45 度
  - VIN / 铭牌
  - 前排座椅
  - 后排座椅
  - 仪表台
  - 里程表读数
- 每张照片写入水印：
  - 当前拍摄项目
  - 本地时间
  - GPS 经纬度
  - 定位精度
- 只有 9 张都拍完后，Jotform 表单才能提交
- 通过 Jotform Widget API 返回字符串值

## 返回给 Jotform 的值

组件会返回一个 JSON 字符串，包含 9 张照片：

```json
{
  "proofMode": "camera-only-9-photos",
  "total": 9,
  "completedAt": "2026-05-27T00:00:00.000Z",
  "photos": [
    {
      "index": 1,
      "key": "front_left_45",
      "label": "车身左前 45 度",
      "imageDataUrl": "data:image/jpeg;base64,...",
      "metadata": {}
    }
  ]
}
```

## 部署方式

1. 将本目录上传到支持 HTTPS 的静态托管服务，例如 Netlify、Vercel、Cloudflare Pages、S3 + CloudFront 或自己的服务器。
2. 确认可以公网访问 `https://your-domain.example/index.html`。
3. 在 Jotform 创建 Custom Widget，并将 Widget URL 填为该地址。
4. 在表单里添加该组件。

## 注意

摄像头和定位通常必须在 HTTPS 页面中才能正常使用。前端组件可以提高可信度，但不能绝对防伪；用户仍可能伪造定位、系统时间或虚拟摄像头。需要更高证明力时，应加服务端接收图片和元数据、写入服务端时间、生成 hash，并存储签名结果。

Jotform 字段值会包含 base64 图片，9 张照片可能比较大。正式业务建议改成先上传到自己的服务器、S3、Cloudflare R2 或 Dropbox，再让 Jotform 只保存图片 URL、元数据和 hash。
