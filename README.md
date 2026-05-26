# Jotform 现场拍照证明组件

这是一个独立的 Jotform Custom Widget，不依赖现有项目，也不需要 React/Vue/打包工具。把整个目录部署到 HTTPS 静态站点后，将 `index.html` 的公网地址配置到 Jotform 自定义组件即可。

## 文件

- `index.html`：组件页面
- `styles.css`：组件样式
- `widget.js`：摄像头、定位、水印、Jotform 通信逻辑

## 能力

- 只调用摄像头拍照，不提供文件上传入口
- 优先调用后置摄像头
- 请求高精度定位
- 在照片上写入水印：
  - 现场拍照证明
  - 本地时间
  - GPS 经纬度
  - 定位精度
- 通过 Jotform Widget API 返回字符串值

## 返回给 Jotform 的值

组件会返回一个 JSON 字符串：

```json
{
  "imageDataUrl": "data:image/jpeg;base64,...",
  "metadata": {
    "time": {
      "iso": "2026-05-27T00:00:00.000Z",
      "local": "2026/05/27 08:00:00",
      "timezoneOffsetMinutes": -480
    },
    "location": {
      "latitude": 0,
      "longitude": 0,
      "accuracy": 10,
      "sourceTimestamp": "2026-05-27T00:00:00.000Z"
    },
    "browserUserAgent": "...",
    "proofMode": "camera-only",
    "fileUploadDisabled": true
  }
}
```

## 部署方式

1. 将本目录上传到支持 HTTPS 的静态托管服务，例如 Netlify、Vercel、Cloudflare Pages、S3 + CloudFront 或自己的服务器。
2. 确认可以公网访问 `https://your-domain.example/index.html`。
3. 在 Jotform 创建 Custom Widget，并将 Widget URL 填为该地址。
4. 在表单里添加该组件。

## 注意

摄像头和定位通常必须在 HTTPS 页面中才能正常使用。前端组件可以提高可信度，但不能绝对防伪；用户仍可能伪造定位、系统时间或虚拟摄像头。需要更高证明力时，应加服务端接收图片和元数据、写入服务端时间、生成 hash，并存储签名结果。
