import { describe, expect, it } from "vitest";
import { professionalStatusAt } from "../src/shared/utils/professionalStatus";

const TZ = "Africa/Luanda";
// 8 de nov. de 2026, horas de Luanda (UTC+1).
const at = (time: string) => new Date(`2026-11-08T${time}:00+01:00`);
const window = (start: string, end: string) => ({ start: at(start), end: at(end) });
const OPEN_9_TO_18 = [{ startMinute: 9 * 60, endMinute: 18 * 60 }];

const status = (now: string, appointments: ReturnType<typeof window>[] = [], blocks: ReturnType<typeof window>[] = []) =>
  professionalStatusAt({ now: at(now), timeZone: TZ, dayHours: OPEN_9_TO_18, appointments, blocks });

describe("estado do profissional", () => {
  it("livre, e até quando (a próxima marcação)", () => {
    const result = status("10:00", [window("11:30", "12:00")]);
    expect(result.status).toBe("AVAILABLE");
    expect(result.nextBusyAt).toEqual(at("11:30"));
  });

  it("a atender: livre quando acaba a marcação", () => {
    const result = status("10:10", [window("10:00", "10:40")]);
    expect(result).toMatchObject({ status: "BUSY", until: at("10:40"), freeAt: at("10:40") });
  });

  it("marcações seguidas: só fica livre no fim da última", () => {
    const result = status("10:10", [window("10:00", "10:40"), window("10:40", "11:20")]);
    expect(result.freeAt).toEqual(at("11:20"));
  });

  it("ocupado até fechar: hoje já não fica livre", () => {
    expect(status("17:00", [window("16:30", "18:00")]).freeAt).toBeNull();
  });

  it("ausente o resto do dia, ou só até uma hora", () => {
    expect(status("10:00", [], [window("09:00", "23:59")])).toMatchObject({ status: "AWAY", until: null, freeAt: null });
    expect(status("10:00", [], [window("09:00", "13:00")])).toMatchObject({ status: "AWAY", until: at("13:00"), freeAt: at("13:00") });
  });

  it("fora do horário: e quando abre", () => {
    expect(status("08:00")).toMatchObject({ status: "OFF_HOURS", opensAt: at("09:00") });
    expect(status("19:00")).toMatchObject({ status: "OFF_HOURS", opensAt: null });
  });
});
