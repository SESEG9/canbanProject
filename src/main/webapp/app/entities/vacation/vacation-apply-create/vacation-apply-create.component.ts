import { Component, OnInit } from '@angular/core';
import { NgbCalendar, NgbDate, NgbDateParserFormatter } from '@ng-bootstrap/ng-bootstrap';
import * as FontAwesome from '@fortawesome/free-solid-svg-icons';
import { IVacation, VacationApply } from '../vacation.model';
import { VacationDateService } from '../service/vacation-date.service';
import { Remaining, VacationService } from '../service/vacation.service';
import { VacationState } from '../../enumerations/vacation-state.model';
import { FixedVacation, FixedVacationService } from '../service/fixed-vacation.service';
import { AlertService } from '../../../core/util/alert.service';

@Component({
  selector: 'jhi-vacation-apply-create',
  templateUrl: './vacation-apply-create.component.html',
  styleUrls: ['./vacation-apply-create.component.scss', '../../room/room.global.scss'],
})
export class VacationApplyCreateComponent implements OnInit {
  public isCollapsed = false;

  hoveredDate: NgbDate | null = null;

  fromDate: NgbDate | null;
  toDate: NgbDate | null;

  availableVacation = 0;

  choosenDays: number | null;

  faCalendarIcon = FontAwesome.faCalendarDays;
  faQuestionIcon = FontAwesome.faQuestion;
  faCheckmarkIcon = FontAwesome.faCheck;
  faCrossIcon = FontAwesome.faXmark;

  vacations: FixedVacation[] = [];

  VacationState = VacationState;

  year = new Date().getFullYear();

  startYear: { year: number; remaining: number } | null = null;
  endYear: { year: number; remaining: number } | null = null;

  constructor(
    private calendar: NgbCalendar,
    public formatter: NgbDateParserFormatter,
    public vacationDateService: VacationDateService,
    private vacationService: VacationService,
    private fixedVacationService: FixedVacationService,
    private alertService: AlertService
  ) {
    this.fromDate = null;
    this.toDate = null;
    this.choosenDays = null;
  }

  ngOnInit(): void {
    // TODO query for free days and current lists
    this.loadVacations();
  }

  onDateSelection(date: NgbDate): void {
    if (!this.fromDate && !this.toDate) {
      this.fromDate = date;
      this.updateChosenDays();
    } else if (this.fromDate && !this.toDate && date.after(this.fromDate)) {
      this.toDate = date;
      this.updateChosenDays();
    } else {
      this.toDate = null;
      this.fromDate = date;
      this.updateChosenDays();
    }
  }

  updateChosenDays(): void {
    if (this.fromDate && this.toDate) {
      this.updateAdditionalRemainingDays(this.fromDate, this.toDate);
      const fromDateJs = VacationApplyCreateComponent.ngbDateToJsDate(this.fromDate);
      const toDateJs = VacationApplyCreateComponent.ngbDateToJsDate(this.toDate);
      this.choosenDays = this.vacationDateService.getVacationDays(fromDateJs, toDateJs);
    }
  }

  private updateAdditionalRemainingDays(fromDate: NgbDate, toDate: NgbDate): void {
    this.startYear = null;
    this.endYear = null;
    this.vacationService.remaining({ year: fromDate.year, includeRequested: true }).subscribe(res => {
      this.startYear = { year: fromDate.year, remaining: res.body?.remainingDays ?? 0 };
    });
    this.vacationService.remaining({ year: toDate.year, includeRequested: true }).subscribe(res => {
      this.endYear = { year: toDate.year, remaining: res.body?.remainingDays ?? 0 };
    });
  }

  static ngbDateToJsDate(ngbDate: NgbDate): Date {
    return new Date(Date.UTC(ngbDate.year, ngbDate.month - 1, ngbDate.day));
  }

  isHovered(date: NgbDate): boolean | null {
    return this.fromDate && !this.toDate && this.hoveredDate && date.after(this.fromDate) && date.before(this.hoveredDate);
  }

  isInside(date: NgbDate): boolean | null {
    return this.toDate && date.after(this.fromDate) && date.before(this.toDate);
  }

  isRange(date: NgbDate): boolean | null {
    return date.equals(this.fromDate) || (this.toDate && date.equals(this.toDate)) || this.isInside(date) || this.isHovered(date);
  }

  validateInput(currentValue: NgbDate | null, input: string): NgbDate | null {
    const parsed = this.formatter.parse(input);
    return parsed && this.calendar.isValid(NgbDate.from(parsed)) ? NgbDate.from(parsed) : currentValue;
  }

  applyVacation(): void {
    if (this.fromDate && this.toDate) {
      const vacationApply: VacationApply = {
        start: VacationApplyCreateComponent.ngbDateToJsDate(this.fromDate),
        end: VacationApplyCreateComponent.ngbDateToJsDate(this.toDate),
        state: 'APPLIED',
      };

      if (this.validate(vacationApply)) {
        this.vacationService.apply(vacationApply).subscribe({
          next: res => {
            this.alertService.addAlert({
              type: 'success',
              message: `Urlaub von ${new Intl.DateTimeFormat('de-AT').format(vacationApply.start)} bis ${new Intl.DateTimeFormat(
                'de-AT'
              ).format(vacationApply.end)}`,
              timeout: 2000,
            });
            this.loadVacations();
            this.toDate = null;
            this.fromDate = null;
            this.startYear = null;
            this.endYear = null;
          },
        });
      }
    }
  }

  private validate(vacationApply: VacationApply): boolean {
    if (vacationApply.start.getTime() < VacationApplyCreateComponent.getYesterday().getTime()) {
      this.alertService.addAlert({
        type: 'danger',
        message: 'Startdatum liegt in der Vergangenheit!',
        timeout: 5000,
      });
      return false;
    }
    if (vacationApply.end.getTime() < vacationApply.start.getTime()) {
      this.alertService.addAlert({ type: 'danger', message: 'Startdatum liegt vor Enddatum!', timeout: 5000 });
      return false;
    }
    if (
      this.getStartYearRemainingDays() < 0 ||
      (this.startYear && this.showStartModal() && this.getStartYearRemainingDays() < 0) ||
      (this.endYear && this.showEndModal() && this.getEndYearRemainingDays() < 0)
    ) {
      this.alertService.addAlert({ type: 'danger', message: 'Nicht genug Resturlaub vorhanden!', timeout: 5000 });
      return false;
    }
    if (
      this.vacations
        .filter(item => item.state !== VacationState.DECLINED)
        .some(item => VacationApplyCreateComponent.overlapps(vacationApply, item))
    ) {
      this.alertService.addAlert({
        type: 'danger',
        message: 'Urlaub überschneidet sich mit existierendem Eintrag!',
        timeout: 5000,
      });
      return false;
    }
    return true;
  }

  private static getYesterday(): Date {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date;
  }

  private static overlapps(vacationApply: VacationApply, fixVacation: FixedVacation): boolean {
    return (
      this.liesInBetween(vacationApply.start, fixVacation.start.toDate(), fixVacation.end.toDate()) ||
      this.liesInBetween(vacationApply.end, fixVacation.start.toDate(), fixVacation.end.toDate()) ||
      this.liesInBetween(fixVacation.start.toDate(), vacationApply.start, vacationApply.end) ||
      this.liesInBetween(fixVacation.end.toDate(), vacationApply.start, vacationApply.end)
    );
  }

  private static liesInBetween(checkDate: Date, start: Date, end: Date): boolean {
    return start.getTime() < checkDate.getTime() && checkDate.getTime() < end.getTime();
  }

  loadVacations(): void {
    const query = {
      start: `${this.year}-01-01`,
      end: `${this.year + 1}-01-01`,
      currentUserOnly: true,
    };
    this.vacationService.query(query).subscribe({ next: res => this.onDataFetched(res.body) });

    this.vacationService.remaining({ year: new Date().getFullYear(), includeRequested: true }).subscribe({
      next: res => {
        this.onRemainingFetched(res.body);
      },
    });
  }

  private onDataFetched(vacations: IVacation[] | null): void {
    if (vacations != null) {
      this.vacations = this.fixedVacationService.vacationsToFixedVacations(vacations);
    }
  }

  private onRemainingFetched(remaining?: Remaining | null): void {
    if (remaining) {
      this.availableVacation = remaining.remainingDays;
    }
  }

  showStartModal(): boolean {
    return this.startYear?.year !== this.year;
  }

  showEndModal(): boolean {
    return this.endYear?.year !== this.year && this.startYear?.year !== this.endYear?.year;
  }

  getThisYearRemainingDays(): number {
    if (this.fromDate && this.toDate && this.fromDate.year === this.year) {
      const fromDateJs = VacationApplyCreateComponent.ngbDateToJsDate(this.fromDate);
      const toDateJs =
        this.toDate.year === this.year ? VacationApplyCreateComponent.ngbDateToJsDate(this.toDate) : new Date(Date.UTC(this.year, 11, 31));

      return this.availableVacation - this.vacationDateService.getVacationDays(fromDateJs, toDateJs);
    } else {
      return this.availableVacation;
    }
  }

  getStartYearRemainingDays(): number {
    if (this.startYear && this.fromDate && this.toDate && this.fromDate.year === this.startYear.year) {
      const fromDateJs = VacationApplyCreateComponent.ngbDateToJsDate(this.fromDate);
      const toDateJs = VacationApplyCreateComponent.ngbDateToJsDate(this.toDate);
      return this.vacationDateService.getRemainingDaysForStartYear(fromDateJs, toDateJs, this.startYear.remaining);
    } else {
      return this.startYear?.remaining ?? 0;
    }
  }

  getEndYearRemainingDays(): number {
    if (this.endYear && this.fromDate && this.toDate && this.toDate.year === this.endYear.year) {
      const toDateJs = VacationApplyCreateComponent.ngbDateToJsDate(this.toDate);
      return this.vacationDateService.getRemainingDaysForEndYear(toDateJs, this.endYear.remaining);
    } else {
      return this.endYear?.remaining ?? 0;
    }
  }
}
