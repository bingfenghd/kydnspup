# 第三方代码、素材与名称声明

本项目自行编写的代码以 [MIT](LICENSE) 授权。第三方代码、地图及品牌素材保留各自的权利与适用条件，不因顶层 MIT 文件而被重新授权。DNSPup 节点服务及 API 账户授权与代码许可独立。

## 中国地图数据

`src/legacy/data/china.json` 源于 [阿里云 DataV GeoAtlas 中国地图数据](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)，当前文件做过数据精简。

依照 [阿里云官方说明](https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)：**DataV.GeoAtlas 工具中的数据来自高德开放平台，仅供学习和交流使用。** 版权问题请向 [高德开放平台](https://lbs.amap.com/) 确认。

该地图数据不适用本项目 MIT 许可证。本项目未取得或声明额外的商业使用、再授权或公开分发许可；商业使用或分发前应向原权利人确认相应权限。保留本说明不等于取得额外授权。

## 品牌与来源

现有 DNSPup Logo 和 favicon 沿用项目自身的品牌素材，不是 ITDOG 官方素材。MIT 代码许可不授予以 DNSPup 或 ITDOG 名义提供官方服务、使用商标作背书的权利。部署者可通过站长管理端设置自己的站点名称和 Logo。

ITDOG 仅用于描述同类拨测产品及界面风格；本项目与 ITDOG 无官方关联，不是 ITDOG 官方开源版本。代码通过 DNSPup 客户 API 提供节点检测。

## 运行依赖

以下清单按锁文件中的实际版本整理。保留上游许可证全文、版权声明及存在的 NOTICE，副本位于 `licenses/`，Docker 镜像中也随附这些文件。未修改上游依赖源码。

| 依赖 | 版本 | 上游许可 | 随附声明 |
| --- | --- | --- | --- |
| base64-arraybuffer | 1.0.2 | MIT | [LICENSE](licenses/base64-arraybuffer/LICENSE) |
| css-line-break | 2.1.0 | MIT | [LICENSE](licenses/css-line-break/LICENSE) |
| echarts | 6.1.0 | Apache-2.0 | [LICENSE](licenses/echarts/LICENSE)、[NOTICE](licenses/echarts/NOTICE)、[LICENSE-d3](licenses/echarts/licenses/LICENSE-d3) |
| echarts-for-react | 3.0.6 | MIT | [LICENSE](licenses/echarts-for-react/LICENSE) |
| fast-deep-equal | 3.1.3 | MIT | [LICENSE](licenses/fast-deep-equal/LICENSE) |
| html2canvas | 1.4.1 | MIT | [LICENSE](licenses/html2canvas/LICENSE) |
| lucide-react | 0.468.0 | ISC | [LICENSE](licenses/lucide-react/LICENSE) |
| react | 19.0.0 | MIT | [LICENSE](licenses/react/LICENSE) |
| react-dom | 19.0.0 | MIT | [LICENSE](licenses/react-dom/LICENSE) |
| scheduler | 0.25.0 | MIT | [LICENSE](licenses/scheduler/LICENSE) |
| size-sensor | 1.0.3 | ISC | [UPSTREAM-LICENSE-DECLARATION.md](licenses/size-sensor/UPSTREAM-LICENSE-DECLARATION.md) |
| text-segmentation | 1.0.3 | MIT | [LICENSE](licenses/text-segmentation/LICENSE) |
| tslib | 2.3.0 | 0BSD | [LICENSE.txt](licenses/tslib/LICENSE.txt) |
| utrie | 1.0.2 | MIT | [LICENSE](licenses/utrie/LICENSE) |
| zrender | 6.1.0 | BSD-3-Clause | [LICENSE](licenses/zrender/LICENSE) |

ECharts 另含 D3 的 BSD 声明；Lucide 的许可文件包含 Feather 来源说明，均保留全文。`size-sensor` 上游声明为 ISC，但发布包未附独立 LICENSE 全文，此处保留其作者与原始许可声明，没有自行补造版权年份。

开发工具依照各自 npm 包所附许可使用；源码候选包不包含 `node_modules/`。更新依赖版本后应重新核对本清单与许可证副本。
