import { useState } from "react";
import { Upload } from "lucide-react";
import { WorkOrderUploadPanel } from "@/components/upload/work-order-upload-panel";
import { DemoDataPanel } from "@/components/upload/demo-data-panel";
import { TrialReadinessPanel } from "@/components/upload/trial-readiness-panel";

export default function UploadPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDataChange = () => setRefreshKey((k) => k + 1);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Upload className="w-5 h-5 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Upload Work Orders</h1>
          <p className="text-sm text-muted-foreground">
            Upload a CSV export from your work order system. Ascent learns from each upload — weekly uploads give the best results.
          </p>
        </div>
      </div>

      <TrialReadinessPanel onRefresh={refreshKey} />
      <WorkOrderUploadPanel onSuccess={handleDataChange} />
      <DemoDataPanel onChange={handleDataChange} />
    </div>
  );
}
