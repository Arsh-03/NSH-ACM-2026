import clsx from "clsx";
import svgPaths from "./svg-2gbe90s142";
import imgFrame2 from "../assets/9394663ed06f79040e5fccebf1cd472a901e3df0.png";
import imgFrame3 from "../assets/ab200c4fdecc0a845ba3d8d89b9708fc96134892.png";
import imgSatellite from "../assets/6292a4c2f7fce59afb681a45c010a7b66e40fa69.png";
import imgWarning from "../assets/f85026c63fdf650839667e94cb9920852e2d6935.png";
type Frame22Helper1Props = {
  additionalClassNames?: string;
};

function Frame22Helper1({ children, additionalClassNames = "" }: React.PropsWithChildren<Frame22Helper1Props>) {
  return (
    <div className={clsx("absolute size-[7px]", additionalClassNames)}>
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 7 7">
        {children}
      </svg>
    </div>
  );
}

function Wrapper({ children }: React.PropsWithChildren<{}>) {
  return (
    <div className="absolute inset-[-1px_0_0_0]">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1333 1">
        {children}
      </svg>
    </div>
  );
}
type Frame22HelperProps = {
  additionalClassNames?: string;
};

function Frame22Helper({ children, additionalClassNames = "" }: React.PropsWithChildren<Frame22HelperProps>) {
  return (
    <div className={clsx("absolute size-[11px]", additionalClassNames)}>
      <div className="absolute inset-[-18.18%_-36.36%_-54.55%_-36.36%]">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 19 19">
          {children}
        </svg>
      </div>
    </div>
  );
}

function DashboardHelper1() {
  return <p className="mb-0">{`massa id dui. tincidunt non consectetur amet, odio Nam viverra in dui. libero, faucibus at efficitur. lacus amet, Donec vel `}</p>;
}
type DashboardHelperProps = {
  additionalClassNames?: string;
};

function DashboardHelper({ additionalClassNames = "" }: DashboardHelperProps) {
  return (
    <div className={clsx("absolute h-0 left-[31px] w-[1333px]", additionalClassNames)}>
      <Wrapper>
        <line id="Line 6" stroke="var(--stroke-0, #606060)" x2="1333" y1="0.5" y2="0.5" />
      </Wrapper>
    </div>
  );
}
type TextProps = {
  text: string;
  additionalClassNames?: string;
};

function Text({ text, additionalClassNames = "" }: TextProps) {
  return (
    <div className={clsx("absolute bg-[#606060] content-stretch flex items-center justify-center px-[8px] py-[4px] rounded-[6px]", additionalClassNames)}>
      <p className="font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[10px] text-white whitespace-nowrap">{text}</p>
    </div>
  );
}
type BullseyeRadarHelperProps = {
  additionalClassNames?: string;
};

function BullseyeRadarHelper({ additionalClassNames = "" }: BullseyeRadarHelperProps) {
  return (
    <div className={clsx("absolute h-[190.5px] left-[301px] w-0", additionalClassNames)}>
      <div className="absolute inset-[0_-0.5px]">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 1 190.5">
          <path d="M0.5 190.5V0" id="Vector 53" stroke="var(--stroke-0, #606060)" />
        </svg>
      </div>
    </div>
  );
}
type Helper1Props = {
  text: string;
  text1: string;
  additionalClassNames?: string;
};

function Helper1({ text, text1, additionalClassNames = "" }: Helper1Props) {
  return (
    <div className={clsx("content-stretch flex flex-col font-['SF_Compact_Rounded:Regular',sans-serif] gap-[8px] items-start leading-[normal] not-italic relative", additionalClassNames)}>
      <p className="relative shrink-0 text-[#bbb] text-[20px] w-full">{text}</p>
      <p className="relative shrink-0 text-[18px] text-white w-full">{text1}</p>
    </div>
  );
}
type SatelliteImageProps = {
  additionalClassNames?: string;
};

function SatelliteImage({ additionalClassNames = "" }: SatelliteImageProps) {
  return (
    <div className={clsx("relative shrink-0", additionalClassNames)}>
      <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgSatellite} />
    </div>
  );
}
type HelperProps = {
  additionalClassNames?: string;
};

function Helper({ additionalClassNames = "" }: HelperProps) {
  return (
    <div className={clsx("size-[17px]", additionalClassNames)}>
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 17 17">
        <circle cx="8.5" cy="8.5" fill="var(--fill-0, #D9D9D9)" id="Ellipse 1" r="8.5" />
      </svg>
    </div>
  );
}
type SatelliteStatsProps = {
  className?: string;
  property1?: "ST - 001" | "ST - 002" | "ST - 003" | "ST - 004";
};

function SatelliteStats({ className, property1 = "ST - 001" }: SatelliteStatsProps) {
  const isSt002 = property1 === "ST - 002";
  const isSt002OrSt003OrSt004 = ["ST - 002", "ST - 003", "ST - 004"].includes(property1);
  const isSt003 = property1 === "ST - 003";
  const isSt004 = property1 === "ST - 004";
  return (
    <div className={className || `bg-[#03020e] relative w-[1331px] ${isSt002OrSt003OrSt004 ? "h-[32px]" : ""}`}>
      <div className="flex flex-row items-center size-full">
        <div className={`content-stretch flex font-["SF_Compact_Rounded:Regular",sans-serif] items-center leading-[normal] not-italic pl-[20px] pr-[78px] py-[5px] relative text-[16px] text-white ${isSt002OrSt003OrSt004 ? "gap-[90px] size-full" : "gap-[89px] w-full"}`}>
          <p className="relative shrink-0 whitespace-nowrap">{isSt004 ? "ST-004" : isSt003 ? "ST-003" : isSt002 ? "ST-002" : "ST-001"}</p>
          <p className="relative shrink-0 whitespace-nowrap">{isSt004 ? "302.2" : isSt003 ? "360.2" : isSt002 ? "320.2" : "305.5"}</p>
          <p className="relative shrink-0 whitespace-nowrap">{isSt004 ? "16.8" : isSt003 ? "20.6" : isSt002 ? "18.6" : "24.8"}</p>
          <p className="relative shrink-0 whitespace-nowrap">{isSt004 ? "365.6km" : isSt003 ? "401.6km" : isSt002 ? "385.6km" : "412.8 km"}</p>
          <p className="relative shrink-0 whitespace-nowrap">{isSt004 ? "20.3658" : isSt003 ? "58.3658" : isSt002 ? "50.3658" : "42.3456"}</p>
          <p className="relative shrink-0 whitespace-nowrap">{isSt004 ? "-44.0879.1 km" : isSt003 ? "-51.0879.1 km" : isSt002 ? "-66.0879.1 km" : "-71.0589.8 km"}</p>
          <p className="relative shrink-0 whitespace-nowrap">{isSt004 ? "6.88 km/s" : isSt003 ? "7.88 km/s" : isSt002 ? "5.88 km/s" : "7.66 km/s"}</p>
          <p className="relative shrink-0 whitespace-nowrap">{isSt003 ? "60.52 kg" : ["ST - 002", "ST - 004"].includes(property1) ? "53.52 kg" : "48.89 kg"}</p>
          <p className="flex-[1_0_0] min-h-px min-w-px relative whitespace-pre-wrap">{isSt004 ? "          4" : isSt003 ? "           2" : isSt002 ? "          6" : "           10"}</p>
        </div>
      </div>
    </div>
  );
}
type AlertCardsProps = {
  className?: string;
  property1?: "High Risk Card" | "Low Risk Card" | "Medium Risk Card";
};

function AlertCards({ className, property1 = "High Risk Card" }: AlertCardsProps) {
  const isHighRiskCard = property1 === "High Risk Card";
  const isLowRiskCard = property1 === "Low Risk Card";
  const isMediumRiskCard = property1 === "Medium Risk Card";
  return (
    <div className={className || `relative rounded-[6px] w-[592px] ${isHighRiskCard ? "bg-[#2c2132]" : isMediumRiskCard ? "bg-[#2c2d33]" : "bg-[#122d32]"}`}>
      <div className="content-stretch flex flex-col gap-[12px] items-start overflow-clip px-[22px] py-[24px] relative rounded-[inherit] w-full">
        <div className="content-stretch flex items-end justify-between relative shrink-0 w-full">
          <p className="font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[#d2d2d2] text-[24px] whitespace-nowrap">Alert #007</p>
          <div className="content-stretch flex items-center justify-center px-[8px] py-[4px] relative rounded-[6px] shrink-0">
            <div aria-hidden="true" className={`absolute border border-solid inset-0 pointer-events-none rounded-[6px] ${isHighRiskCard ? "border-[#ff4442]" : isMediumRiskCard ? "border-[#e7c852]" : "border-[#05c04a]"}`} />
            <p className={`font-["SF_Pro_Rounded:Regular",sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] whitespace-nowrap ${isHighRiskCard ? "text-[#ff4442]" : isMediumRiskCard ? "text-[#e7c852]" : "text-[#05c04a]"}`}>{isMediumRiskCard ? "Medium Risk" : isLowRiskCard ? "Low Risk" : "High Risk"}</p>
          </div>
        </div>
        <div className="content-start flex flex-wrap font-['SF_Pro_Rounded:Regular',sans-serif] gap-[8px_417px] items-start leading-[normal] not-italic relative shrink-0 text-[#d2d2d2] text-[16px] w-full whitespace-nowrap">
          <p className="relative shrink-0">Satellite:</p>
          <p className="relative shrink-0">SAT - 001</p>
          <p className="relative shrink-0">Debris:</p>
          <p className="relative shrink-0">{isMediumRiskCard ? "DEB - 5201" : isLowRiskCard ? "DEB - 4859" : "DEB - 4521"}</p>
        </div>
        <div className="h-0 relative shrink-0 w-full">
          <div className="absolute inset-[-1px_0_0_0]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 548 1">
              <line id="Line 5" stroke="var(--stroke-0, #606060)" x2="548" y1="0.5" y2="0.5" />
            </svg>
          </div>
        </div>
        <div className="content-stretch flex items-center justify-between relative shrink-0 w-full">
          <div className="content-stretch flex gap-[4px] items-center relative shrink-0">
            <div className="overflow-clip relative shrink-0 size-[14px]" data-name="mingcute:time-fill">
              <div className="absolute inset-[8.33%_8.33%_0.78%_8.33%]" data-name="Group">
                <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 11.6667 12.7248">
                  <g id="Group">
                    <g id="Vector" />
                    <path d={svgPaths.pf26f80} fill="var(--fill-0, white)" id="Vector_2" />
                  </g>
                </svg>
              </div>
            </div>
            <p className="font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[#d2d2d2] text-[16px] whitespace-nowrap">TCA:</p>
          </div>
          <p className="font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[#d2d2d2] text-[16px] whitespace-nowrap">{isMediumRiskCard ? "03: 32: 12" : isLowRiskCard ? "04: 42: 02" : "02: 34: 18"}</p>
        </div>
      </div>
      <div aria-hidden="true" className={`absolute border border-solid inset-0 pointer-events-none rounded-[6px] ${isHighRiskCard ? "border-[#ff4442]" : isMediumRiskCard ? "border-[#e7c852]" : "border-[#05c04a]"}`} />
    </div>
  );
}

export default function Dashboard() {
  return (
    <div className="bg-[#03020e] relative size-full" data-name="Dashboard">
      <div className="absolute bg-[#0b1124] border border-[#1f3c5e] border-solid h-[664px] left-[31px] rounded-[6px] top-[94px] w-[1333px]" />
      <div className="absolute h-[616px] left-[43px] rounded-[5px] top-[94px] w-[1310px]">
        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[5px]">
          <img alt="" className="absolute h-[133.97%] left-[-1.15%] max-w-none top-[-33.97%] w-[139.11%]" src={imgFrame2} />
        </div>
        <div className="overflow-clip relative rounded-[inherit] size-full">
          <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[312px] left-[calc(50%+7.5px)] overflow-clip rounded-[414px] top-1/2 w-[303px]">
            <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[414px]">
              <img alt="" className="absolute h-[112.89%] left-[-4.62%] max-w-none top-[-7.4%] w-[111.22%]" src={imgFrame3} />
            </div>
            <Helper additionalClassNames="absolute left-[36px] top-[98px]" />
            <Helper additionalClassNames="absolute left-[122px] top-[166px]" />
            <Helper additionalClassNames="absolute left-[135px] top-[269px]" />
            <Helper additionalClassNames="absolute left-[19px] top-[269px]" />
            <Helper additionalClassNames="absolute left-[10px] top-[245px]" />
            <Helper additionalClassNames="absolute left-[234px] top-[90px]" />
            <Helper additionalClassNames="absolute left-[181px] top-[44px]" />
            <Helper additionalClassNames="absolute left-[114px] top-[13px]" />
          </div>
          <Helper additionalClassNames="absolute left-[599px] top-[120px]" />
          <Helper additionalClassNames="absolute left-[616px] top-[464px]" />
          <Helper additionalClassNames="absolute left-[754px] top-[464px]" />
          <Helper additionalClassNames="absolute left-[797px] top-[372px]" />
          <Helper additionalClassNames="absolute left-[814px] top-[308px]" />
          <Helper additionalClassNames="absolute left-[806px] top-[227px]" />
          <Helper additionalClassNames="absolute left-[479px] top-[291px]" />
          <div className="absolute content-stretch flex gap-[8px] items-center left-[24px] top-[527px]">
            <div className="bg-[red] h-[2px] rounded-[2px] shrink-0 w-[30px]" />
            <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white whitespace-nowrap">High Risk</p>
          </div>
          <div className="absolute content-stretch flex gap-[8px] items-center left-[24px] top-[550px]">
            <div className="bg-[#f70] h-[2px] rounded-[2px] shrink-0 w-[30px]" />
            <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white whitespace-nowrap">Medium Risk</p>
          </div>
          <div className="absolute content-stretch flex gap-[8px] items-center left-[24px] top-[573px]">
            <div className="bg-[#00a21e] h-[2px] rounded-[2px] shrink-0 w-[30px]" />
            <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white whitespace-nowrap">Low Risk</p>
          </div>
          <div className="absolute left-[479px] size-[28px] top-[358px]" data-name="Satellite">
            <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgSatellite} />
          </div>
          <div className="absolute h-[217.081px] left-[500px] top-[147.42px] w-[259px]">
            <div className="absolute inset-[-0.23%_-0.18%_0_-0.19%]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 259.946 217.681">
                <path d={svgPaths.p3420b500} id="Vector 70" stroke="var(--stroke-0, #9747FF)" />
              </svg>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="absolute border border-[#1f3c5e] border-solid inset-0 pointer-events-none rounded-[5px]" />
      </div>
      <div className="absolute content-stretch flex gap-[8px] items-center left-[43px] top-[712px]">
        <SatelliteImage additionalClassNames="size-[24px]" />
        <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white whitespace-nowrap">Satellite</p>
      </div>
      <div className="absolute content-stretch flex gap-[8px] items-center left-[168px] top-[714px]">
        <Helper additionalClassNames="relative shrink-0" />
        <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white whitespace-nowrap">Debris</p>
      </div>
      <div className="absolute content-stretch flex gap-[8px] items-center left-[275px] top-[715px]">
        <div className="h-0 relative shrink-0 w-[32px]">
          <div className="absolute inset-[-1px_0_0_0]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 1">
              <g id="Group 1">
                <line id="Line 1" stroke="var(--stroke-0, white)" x2="8" y1="0.5" y2="0.5" />
                <line id="Line 2" stroke="var(--stroke-0, white)" x1="8" x2="16" y1="0.5" y2="0.5" />
                <line id="Line 3" stroke="var(--stroke-0, white)" x1="16" x2="24" y1="0.5" y2="0.5" />
                <line id="Line 4" stroke="var(--stroke-0, white)" x1="24" x2="32" y1="0.5" y2="0.5" />
              </g>
            </svg>
          </div>
        </div>
        <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white whitespace-nowrap">Orbit Path</p>
      </div>
      <div className="absolute content-stretch flex gap-[16px] items-center left-[1379px] top-[20px]">
        <SatelliteImage additionalClassNames="size-[32px]" />
        <div className="content-stretch flex flex-col font-['SF_Compact_Rounded:Regular',sans-serif] gap-[8px] items-start leading-[normal] not-italic relative shrink-0 w-[81px]">
          <p className="relative shrink-0 text-[#d2d2d2] text-[20px] w-full">Satellites</p>
          <p className="relative shrink-0 text-[18px] text-white w-full">04</p>
        </div>
      </div>
      <div className="absolute content-stretch flex gap-[16px] items-center left-[1540px] top-[20px]">
        <div className="relative shrink-0 size-[32px]">
          <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 32">
            <circle cx="16" cy="16" fill="var(--fill-0, #D9D9D9)" id="Ellipse 1" r="16" />
          </svg>
        </div>
        <Helper1 text="Debris" text1="32" additionalClassNames="shrink-0 w-[81px]" />
      </div>
      <div className="absolute content-stretch flex gap-[16px] items-center left-[1701px] top-[20px]">
        <div className="relative shrink-0 size-[32px]" data-name="Warning">
          <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgWarning} />
        </div>
        <Helper1 text="Alerts" text1="02" additionalClassNames="shrink-0 w-[81px]" />
      </div>
      <div className="absolute content-stretch flex gap-[16px] items-center left-[1848px] top-[20px] w-[155px]">
        <div className="overflow-clip relative shrink-0 size-[32px]" data-name="mingcute:time-fill">
          <div className="absolute inset-[8.33%_8.33%_0.78%_8.33%]" data-name="Group">
            <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 26.6667 29.0853">
              <g id="Group">
                <g id="Vector" />
                <path d={svgPaths.p3cc36df0} fill="var(--fill-0, white)" id="Vector_2" />
              </g>
            </svg>
          </div>
        </div>
        <Helper1 text="IST Time" text1="09: 12: 36s" additionalClassNames="flex-[1_0_0] min-h-px min-w-px" />
      </div>
      <div className="absolute content-stretch flex gap-[11px] items-center left-[30px] top-[24px]">
        <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[32px] text-white whitespace-nowrap">Project Aether</p>
        <SatelliteImage additionalClassNames="size-[28px]" />
      </div>
      <DashboardHelper additionalClassNames="top-[70px]" />
      <div className="absolute content-stretch flex gap-[6px] items-center left-[299px] top-[38px]">
        <p className="font-['SF_Compact_Rounded:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[#d2d2d2] text-[20px] w-[108px]">Satellite 001</p>
        <div className="relative shrink-0 size-[13.518px]" data-name="Group">
          <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 13.518 13.518">
            <g id="Group">
              <path clipRule="evenodd" d={svgPaths.p30330c00} fill="var(--fill-0, white)" fillRule="evenodd" id="Vector" />
              <path clipRule="evenodd" d={svgPaths.p3cc271f0} fill="var(--fill-0, white)" fillRule="evenodd" id="Vector_2" />
            </g>
          </svg>
        </div>
      </div>
      <div className="absolute bg-[#d9d9d9] h-[2px] left-[301px] rounded-[3px] top-[69px] w-[126px]" />
      <div className="absolute bg-[#d9d9d9] h-[2px] left-[55px] rounded-[3px] top-[954px] w-[343px]" />
      <div className="absolute contents left-[31px] top-[758px]">
        <div className="absolute bg-white h-[37px] left-[31px] opacity-12 top-[758px] w-[114px]" />
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[47px] text-[12px] text-white top-[769px] w-[81px]">Satellites</p>
      </div>
      <DashboardHelper additionalClassNames="top-[795px]" />
      <div className="absolute h-0 left-[31px] top-[891px] w-[1333px]">
        <Wrapper>
          <line id="Line 12" stroke="var(--stroke-0, #606060)" strokeOpacity="0.2" x2="1333" y1="0.5" y2="0.5" />
        </Wrapper>
      </div>
      <div className="absolute flex h-[361px] items-center justify-center left-[1364px] top-[757px] w-0" style={{ "--transform-inner-width": "1185", "--transform-inner-height": "21" } as React.CSSProperties}>
        <div className="-rotate-90 flex-none">
          <div className="h-0 relative w-[361px]">
            <div className="absolute inset-[-1px_0_0_0]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 361 1">
                <line id="Line 9" stroke="var(--stroke-0, #606060)" x2="361" y1="0.5" y2="0.5" />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bg-[#03020e] content-stretch flex font-['SF_Compact_Rounded:Regular',sans-serif] gap-[99px] h-[32px] items-center leading-[normal] left-[31px] not-italic pl-[20px] pr-[72px] py-[5px] text-[#777] text-[16px] top-[795px] w-[1331px] whitespace-nowrap">
        <p className="relative shrink-0">Satellite</p>
        <p className="relative shrink-0">Az</p>
        <p className="relative shrink-0">El</p>
        <p className="relative shrink-0">Altitude</p>
        <p className="relative shrink-0">Latitude</p>
        <p className="relative shrink-0">Longitude</p>
        <p className="relative shrink-0">Velocity</p>
        <p className="relative shrink-0">Propellant</p>
        <p className="relative shrink-0">Debris</p>
      </div>
      <div className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[51px] text-[#d2d2d2] text-[12px] top-[973px] w-[903px] whitespace-pre-wrap">
        <DashboardHelper1 />
        <p className="mb-0">&nbsp;</p>
        <p className="mb-0">{`quis risus gravida placerat. ex libero, elit. Lorem maximus tortor. tempor Ut consectetur felis, nec non Cras cursus porta `}</p>
        <p className="mb-0">&nbsp;</p>
        <p className="mb-0">{`at, malesuada Quisque lacus, eget non id eu leo. id vitae non. adipiscing faucibus vitae amet, lorem. scelerisque amet, at, `}</p>
        <p className="mb-0">&nbsp;</p>
        <p>&nbsp;</p>
      </div>
      <div className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal h-[29px] leading-[normal] left-[49px] text-[#d2d2d2] text-[12px] top-[1098px] w-[903px] whitespace-pre-wrap">
        <DashboardHelper1 />
        <p className="mb-0">&nbsp;</p>
        <p className="mb-0">&nbsp;</p>
        <p className="mb-0">&nbsp;</p>
        <p>&nbsp;</p>
      </div>
      <div className="absolute bg-[#0b1124] h-[479px] left-[1390px] overflow-clip rounded-[6px] top-[94px] w-[592px]">
        <div className="absolute contents left-[64px] top-[9px]" data-name="Bullseye Radar">
          <div className="absolute h-[53px] left-[301px] top-[368px] w-[128px]">
            <div className="absolute inset-[-0.63%_-0.29%_-0.94%_0]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 128.392 53.832">
                <path d={svgPaths.p3ea6198} id="Vector 41" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-[41px] left-[300px] top-[340px] w-[101px]">
            <div className="absolute inset-[-0.83%_-0.36%_-1.22%_0]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 101.372 41.8406">
                <path d={svgPaths.p11ec500} id="Vector 43" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-[30.5px] left-[300.5px] top-[311.5px] w-[73px]">
            <div className="absolute inset-[-1.2%_-0.47%_-1.64%_0]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 73.342 31.3648">
                <path d={svgPaths.p2ae09f80} id="Vector 45" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-[20px] left-[300px] top-[281.5px] w-[44.5px]">
            <div className="absolute inset-[-1.77%_-0.79%_-2.5%_0]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 44.8536 20.8536">
                <path d={svgPaths.p1466e780} id="Vector 47" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-0 left-[110px] top-[240.5px] w-[191px]">
            <div className="absolute inset-[-0.5px_0]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 191 1">
                <path d="M191 0.5H0" id="Vector 50" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-0 left-[301px] top-[240.5px] w-[189px]">
            <div className="absolute inset-[-0.5px_0]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 189 1">
                <path d="M0 0.5H189" id="Vector 51" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <BullseyeRadarHelper additionalClassNames="top-[50px]" />
          <BullseyeRadarHelper additionalClassNames="top-[241px]" />
          <div className="absolute h-[40.038px] left-[280.43px] top-[219.96px] w-[40.066px]">
            <div className="absolute inset-[-1.25%_-1.24%_-1.24%_-1.25%]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 41.0639 41.034">
                <path d={svgPaths.p33c6a600} id="Vector 55" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-[363px] left-[118px] top-[58px] w-[364px]">
            <div className="absolute inset-[-0.14%]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 365.003 364">
                <path d={svgPaths.p3a3bbf80} id="Vector 56" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-[285px] left-[157px] top-[96px] w-[286px]">
            <div className="absolute inset-[-0.18%]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 287.002 286">
                <path d={svgPaths.p27b37480} id="Vector 58" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-[205px] left-[197px] top-[137px] w-[206px]">
            <div className="absolute inset-[-0.24%]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 207.002 206">
                <path d={svgPaths.p175a2000} id="Vector 60" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <div className="absolute h-[123.5px] left-[238px] top-[178px] w-[123px]">
            <div className="absolute inset-[-0.41%_-0.41%_-0.4%_-0.41%]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 124.002 124.5">
                <path d={svgPaths.p1e5e29c8} id="Vector 62" stroke="var(--stroke-0, #606060)" />
              </svg>
            </div>
          </div>
          <p className="absolute font-['Inter:Regular',sans-serif] font-normal leading-[normal] left-[297px] not-italic text-[12px] text-white top-[453px] whitespace-nowrap">S</p>
          <p className="absolute font-['Inter:Regular',sans-serif] font-normal leading-[normal] left-[64px] not-italic text-[12px] text-white top-[233px] whitespace-nowrap">W</p>
          <p className="absolute font-['Inter:Regular',sans-serif] font-normal leading-[normal] left-[296px] not-italic text-[12px] text-white top-[9px] whitespace-nowrap">N</p>
          <p className="absolute font-['Inter:Regular',sans-serif] font-normal leading-[normal] left-[514px] not-italic text-[12px] text-white top-[233px] whitespace-nowrap">E</p>
        </div>
        <div className="absolute h-[20.02px] left-[300px] top-[240px] w-[20.5px]">
          <div className="absolute inset-[0_-2.44%_-2.5%_0]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 21.0185 20.5199">
              <path d={svgPaths.p36d12800} id="Vector 67" stroke="var(--stroke-0, #606060)" />
            </svg>
          </div>
        </div>
        <div className="absolute h-[310.5px] left-[174px] top-[61px] w-[155.495px]">
          <div className="absolute inset-[-0.78%_-3.38%_-2.58%_-3.54%]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 166.254 320.939">
              <g filter="url(#filter0_d_1_344)" id="Vector 68">
                <path d={svgPaths.p310c1a00} stroke="var(--stroke-0, #1000F2)" />
              </g>
              <defs>
                <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="320.939" id="filter0_d_1_344" width="166.254" x="1.19209e-07" y="8.9407e-08">
                  <feFlood floodOpacity="0" result="BackgroundImageFix" />
                  <feColorMatrix in="SourceAlpha" result="hardAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
                  <feOffset dy="3" />
                  <feGaussianBlur stdDeviation="2.5" />
                  <feComposite in2="hardAlpha" operator="out" />
                  <feColorMatrix type="matrix" values="0 0 0 0 0.501362 0 0 0 0 0.389423 0 0 0 0 1 0 0 0 1 0" />
                  <feBlend in2="BackgroundImageFix" mode="normal" result="effect1_dropShadow_1_344" />
                  <feBlend in="SourceGraphic" in2="effect1_dropShadow_1_344" mode="normal" result="shape" />
                </filter>
              </defs>
            </svg>
          </div>
        </div>
        <Frame22Helper additionalClassNames="left-[211px] top-[154px]">
          <g filter="url(#filter0_d_1_342)" id="Ellipse 2">
            <circle cx="9.5" cy="7.5" fill="var(--fill-0, #1000F1)" r="5.5" />
          </g>
          <defs>
            <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="19" id="filter0_d_1_342" width="19" x="0" y="0">
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feColorMatrix in="SourceAlpha" result="hardAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
              <feOffset dy="2" />
              <feGaussianBlur stdDeviation="2" />
              <feComposite in2="hardAlpha" operator="out" />
              <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0.045674 0 0 0 0 0.913462 0 0 0 1 0" />
              <feBlend in2="BackgroundImageFix" mode="normal" result="effect1_dropShadow_1_342" />
              <feBlend in="SourceGraphic" in2="effect1_dropShadow_1_342" mode="normal" result="shape" />
            </filter>
          </defs>
        </Frame22Helper>
        <Frame22Helper1 additionalClassNames="left-[213px] top-[156px]">
          <g id="Ellipse 3">
            <circle cx="3.5" cy="3.5" fill="var(--fill-0, #1000F1)" r="3.5" />
            <circle cx="3.5" cy="3.5" r="3" stroke="var(--stroke-0, black)" strokeOpacity="0.4" />
          </g>
        </Frame22Helper1>
        <div className="absolute h-[353.5px] left-[274.5px] top-[65.5px] w-[75.5px]">
          <div className="absolute inset-[0_-5.92%_-2.84%_-5.96%]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 84.4694 363.695">
              <g filter="url(#filter0_d_1_338)" id="Vector 69">
                <path d={svgPaths.p245a8880} stroke="var(--stroke-0, #F29500)" />
              </g>
              <defs>
                <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="363.695" id="filter0_d_1_338" width="84.4694" x="-2.98023e-08" y="0">
                  <feFlood floodOpacity="0" result="BackgroundImageFix" />
                  <feColorMatrix in="SourceAlpha" result="hardAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
                  <feOffset dy="6" />
                  <feGaussianBlur stdDeviation="2" />
                  <feComposite in2="hardAlpha" operator="out" />
                  <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 0.661218 0 0 0 0 0.274038 0 0 0 1 0" />
                  <feBlend in2="BackgroundImageFix" mode="normal" result="effect1_dropShadow_1_338" />
                  <feBlend in="SourceGraphic" in2="effect1_dropShadow_1_338" mode="normal" result="shape" />
                </filter>
              </defs>
            </svg>
          </div>
        </div>
        <Frame22Helper additionalClassNames="left-[275px] top-[334px]">
          <g filter="url(#filter0_d_1_352)" id="Ellipse 4">
            <circle cx="9.5" cy="7.5" fill="var(--fill-0, #F19500)" r="5.5" />
          </g>
          <defs>
            <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="19" id="filter0_d_1_352" width="19" x="0" y="0">
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feColorMatrix in="SourceAlpha" result="hardAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
              <feOffset dy="2" />
              <feGaussianBlur stdDeviation="2" />
              <feComposite in2="hardAlpha" operator="out" />
              <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 0.661218 0 0 0 0 0.274038 0 0 0 1 0" />
              <feBlend in2="BackgroundImageFix" mode="normal" result="effect1_dropShadow_1_352" />
              <feBlend in="SourceGraphic" in2="effect1_dropShadow_1_352" mode="normal" result="shape" />
            </filter>
          </defs>
        </Frame22Helper>
        <Frame22Helper1 additionalClassNames="left-[277px] top-[336px]">
          <circle cx="3.5" cy="3.5" fill="var(--fill-0, #F19500)" id="Ellipse 5" r="3" stroke="var(--stroke-0, #FFA946)" />
        </Frame22Helper1>
        <Text text="ST-001 Trajectory" additionalClassNames="left-[166px] top-[76px]" />
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[149px] text-[10px] text-white top-[214px] whitespace-nowrap">10:12</p>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[273px] text-[10px] text-white top-[58px] whitespace-nowrap">10:16</p>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[167px] text-[#1000f1] text-[10px] top-[154px] whitespace-nowrap">ST-001</p>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[294px] text-[#f19500] text-[10px] top-[334px] whitespace-nowrap">ST-002</p>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[136px] text-[10px] text-white top-[326px] whitespace-nowrap">10:08</p>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[238px] text-[10px] text-white top-[395px] whitespace-nowrap">10:01</p>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[255px] text-[10px] text-white top-[254px] whitespace-nowrap">10:10</p>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[293px] text-[10px] text-white top-[123px] whitespace-nowrap">10:15</p>
        <Text text="ST-002 Trajectory" additionalClassNames="left-[334px] top-[103px]" />
        <div className="absolute content-stretch flex flex-col items-start left-[24px] top-[392px] w-[98px]">
          <div className="bg-[#606060] relative shrink-0 w-full">
            <div className="flex flex-row items-center justify-center size-full">
              <div className="content-stretch flex items-center justify-center pl-[8px] pr-[38px] py-[4px] relative w-full">
                <p className="font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[10px] text-white whitespace-nowrap">ST-001</p>
              </div>
            </div>
          </div>
          <div className="bg-[#4a4a4a] relative shrink-0 w-full">
            <div className="flex flex-row items-center justify-center size-full">
              <div className="content-stretch flex items-center justify-center pl-[8px] pr-[38px] py-[8px] relative w-full">
                <div className="font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[8px] text-white whitespace-nowrap">
                  <p className="mb-0">Az 305.8</p>
                  <p className="mb-0">EL 24.4</p>
                  <p>LOS in 06:07</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bg-[#0b1124] h-[323px] left-[1390px] overflow-clip rounded-[6px] top-[593px] w-[592px]">
        <div className="-translate-x-1/2 absolute bg-black border border-[#1f3c5e] border-solid h-[247px] left-[calc(50%-4px)] overflow-clip rounded-[6px] top-[60px] w-[552px]">
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[23px] text-[#606060] text-[14px] top-[23px] whitespace-nowrap">Latitude</p>
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[23px] text-[#606060] text-[14px] top-[95px] whitespace-nowrap">Altitude</p>
          <p className="absolute font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] left-[23px] not-italic text-[#d2d2d2] text-[16px] top-[177px] whitespace-nowrap">Fuel Remaining</p>
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[186px] text-[#606060] text-[14px] top-[23px] whitespace-nowrap">Longitude</p>
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[399px] text-[#606060] text-[14px] top-[23px] whitespace-nowrap">Propellant</p>
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[399px] text-[#606060] text-[14px] top-[93px] whitespace-nowrap">Debris</p>
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[186px] text-[#606060] text-[14px] top-[93px] whitespace-nowrap">Velocity</p>
          <p className="absolute font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] left-[23px] not-italic text-[#d2d2d2] text-[20px] top-[47px] whitespace-nowrap">42.3456</p>
          <p className="absolute font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] left-[23px] not-italic text-[#d2d2d2] text-[20px] top-[119px] whitespace-nowrap">412.8 km</p>
          <p className="absolute font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] left-[186px] not-italic text-[#d2d2d2] text-[20px] top-[47px] whitespace-nowrap">-71.0589.8 km</p>
          <p className="absolute font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] left-[399px] not-italic text-[#d2d2d2] text-[20px] top-[47px] whitespace-nowrap">-71.0589.8 km</p>
          <p className="absolute font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] left-[399px] not-italic text-[#d2d2d2] text-[20px] top-[117px] whitespace-nowrap">10</p>
          <p className="absolute font-['SF_Pro_Rounded:Regular',sans-serif] leading-[normal] left-[186px] not-italic text-[#d2d2d2] text-[20px] top-[117px] whitespace-nowrap">7.66 km/s</p>
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[480px] text-[#d2d2d2] text-[24px] top-[194px] whitespace-nowrap">38%</p>
          <div className="absolute bg-[#d9d9d9] h-[7px] left-[23px] rounded-[7px] top-[207px] w-[446px]" />
          <div className="absolute bg-[#fac800] h-[7px] left-[23px] rounded-[7px] top-[207px] w-[144px]" />
        </div>
        <p className="absolute font-['Azeret_Mono:Regular',sans-serif] font-normal leading-[normal] left-[70px] text-[18px] text-white top-[21px] whitespace-nowrap">Telemetry: SAT - 001</p>
        <div className="absolute h-[32px] left-[16px] top-[16px] w-[42px]">
          <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 42 32">
            <path d={svgPaths.p3eadf400} fill="var(--fill-0, white)" id="Vector 66" />
          </svg>
        </div>
      </div>
      <AlertCards className="absolute bg-[#2c2132] left-[1390px] rounded-[6px] top-[936px] w-[592px]" />
      <SatelliteStats className="absolute bg-[#03020e] left-[32px] top-[827px] w-[1331px]" />
      <SatelliteStats className="absolute bg-[#03020e] h-[32px] left-[31px] top-[856px] w-[1331px]" property1="ST - 002" />
      <SatelliteStats className="absolute bg-[#03020e] h-[32px] left-[31px] top-[888px] w-[1331px]" property1="ST - 002" />
      <SatelliteStats className="absolute bg-[#03020e] h-[32px] left-[31px] top-[920px] w-[1331px]" property1="ST - 004" />
      <div className="absolute bg-white h-[32px] left-[31px] opacity-12 top-[825px] w-[1331px]" />
      <div className="absolute flex h-[75px] items-center justify-center left-[1362px] top-[821px] w-[2px]" style={{ "--transform-inner-width": "1185", "--transform-inner-height": "0" } as React.CSSProperties}>
        <div className="-rotate-90 flex-none">
          <div className="bg-[#777] h-[2px] rounded-[3px] w-[75px]" />
        </div>
      </div>
    </div>
  );
}