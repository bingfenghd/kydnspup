import { MapChart, ScatterChart } from "echarts/charts";
import { GeoComponent, MarkPointComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import chinaMap from "./data/china.json";

echarts.use([MapChart, ScatterChart, GeoComponent, MarkPointComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const displayChinaMap = {
  ...chinaMap,
  features: chinaMap.features.filter((feature) => feature.properties.name).map((feature) => feature.properties.name === "海南省" ? {
    ...feature,
    geometry: { ...feature.geometry, coordinates: feature.geometry.coordinates.slice(0, 1) }
  } : feature)
};
const southChinaSeaMap = {
  ...chinaMap,
  features: chinaMap.features.filter((feature) => !feature.properties.name)
};

echarts.registerMap("china", displayChinaMap as Parameters<typeof echarts.registerMap>[1]);
echarts.registerMap("china-south-sea", southChinaSeaMap as Parameters<typeof echarts.registerMap>[1]);

export default function ChinaProbeMap({ option, onEvents }: { option: unknown; onEvents?: Record<string, (params: { name?: string }) => void> }) {
  return <ReactEChartsCore echarts={echarts} option={option} style={{ height: "100%", width: "100%" }} notMerge={false} lazyUpdate={false} onEvents={onEvents} />;
}
