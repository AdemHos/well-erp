import {
  Check,
  Cloud,
  Laptop,
  Smartphone,
  Tablet,
} from "lucide-react";

const devices = [
  {
    name: "Masaüstü",
    icon: Laptop,
  },
  {
    name: "Tablet",
    icon: Tablet,
  },
  {
    name: "Telefon",
    icon: Smartphone,
  },
];

export default function DevicesSection() {
  return (
    <section className="relative overflow-hidden bg-slate-950 py-24 lg:py-28">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-60"
        style={{
          backgroundImage:
            "url('/images/devices.png')",
        }}
      />

      {/* overlays */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/95 to-slate-950/30" />

      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/40" />

      {/* decorative glow */}
      <div className="absolute -left-32 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-blue-600/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid min-h-[480px] items-center lg:grid-cols-2">
          {/* LEFT */}
          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-xs font-semibold text-blue-300 backdrop-blur">
              <Cloud size={15} />
              BULUT TABANLI
            </div>

            <h2 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
              Her Cihazda,
              <br />
              <span className="text-blue-500">
                Her Yerde
              </span>
            </h2>

            <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
              WellPOS bulut altyapısı sayesinde işletmenize
              bilgisayarınızdan, tabletinizden veya mobil
              cihazınızdan erişin.
            </p>

            {/* devices */}
            <div className="mt-8 flex flex-wrap gap-3">
              {devices.map((device) => {
                const Icon = device.icon;

                return (
                  <div
                    key={device.name}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 backdrop-blur"
                  >
                    <Icon
                      size={17}
                      className="text-blue-400"
                    />

                    {device.name}
                  </div>
                );
              })}
            </div>

            {/* Benefits */}
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Benefit text="Gerçek zamanlı senkronizasyon" />
              <Benefit text="Şubelerinize uzaktan erişim" />
              <Benefit text="Merkezi veri yönetimi" />
              <Benefit text="Otomatik güncellemeler" />
            </div>
          </div>

          {/* right side intentionally left open */}
          <div className="hidden lg:block" />
        </div>
      </div>
    </section>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-300">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
        <Check
          size={12}
          className="text-emerald-400"
          strokeWidth={3}
        />
      </div>

      {text}
    </div>
  );
}