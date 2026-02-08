"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

interface PriceChartProps {
  data: { time: string; price: number }[];
  goodName: string;
}

export function PriceChart({ data, goodName }: PriceChartProps) {
  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title={`${goodName} Price History`}
        subtitle="Recent price fluctuations"
      />
      <CardContent>
        <div className="w-full h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="time"
                stroke="#666"
                tick={{ fill: "#999", fontSize: 12 }}
              />
              <YAxis
                stroke="#666"
                tick={{ fill: "#999", fontSize: 12 }}
                tickFormatter={(v: number) => `${v} CR`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1a2e",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                }}
                labelStyle={{ color: "#999" }}
                formatter={(value: number | undefined) => [`${value ?? 0} CR`, "Price"]}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ fill: "#60a5fa", strokeWidth: 0, r: 4 }}
                activeDot={{ r: 6, fill: "#93c5fd" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
