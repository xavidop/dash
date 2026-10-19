import type { AppState } from '../types';
import { clock, ampm, longDate, greeting, localTime, hourLabel, dayName, esc } from '../format';
import { weatherIcon, ICON } from '../icons';
import { staleLabel } from '../ui';
import { t } from '../i18n';
import { renderTodayStrip, fitTodayStrip } from './today';

export function renderHome(el: HTMLElement, s: AppState) {
  const w = s.sections.weather?.data;
  const loc = s.sections.location?.data;
  const name = s.config?.userName;
  const place = loc?.city || w?.place || '';

  const weather = w
    ? `
    <div class="now-weather">
      <div class="now-icon">${weatherIcon(w.current.icon, w.current.isDay, { animated: true })}</div>
      <div class="now-temp">${w.current.temp}<span class="deg">°</span></div>
      <div class="now-meta">
        <div class="now-desc">${esc(w.current.desc)}</div>
        <div class="now-range"><span>${t('home.max', { t: w.today.max })}</span><span>${t('home.min', { t: w.today.min })}</span></div>
        <div class="now-extra">
          <span>${ICON.drop} ${w.today.precip}%</span>
          <span>${ICON.wind} ${w.current.wind} km/h</span>
        </div>
      </div>
    </div>`
    : `<div class="now-weather placeholder">${t('home.loadingWeather')}</div>`;

  const hourly = w
    ? w.hourly
        .map(
          (h) => `<div class="hour">
            <div class="hour-t">${hourLabel(h.time)}</div>
            ${weatherIcon(h.icon, h.isDay)}
            <div class="hour-temp">${h.temp}°</div>
            <div class="hour-p ${h.precip >= 30 ? 'wet' : ''}">${h.precip >= 10 ? `${ICON.drop}${h.precip}%` : '&nbsp;'}</div>
          </div>`,
        )
        .join('')
    : '';

  const daily = w
    ? w.daily
        .map(
          (d) => `<div class="day">
            <div class="day-n">${esc(dayName(d.date))}</div>
            ${weatherIcon(d.icon, true)}
            <div class="day-r"><b>${d.max}°</b><span>${d.min}°</span></div>
            <div class="hour-p ${d.precip >= 30 ? 'wet' : ''}">${d.precip >= 10 ? `${ICON.drop}${d.precip}%` : '&nbsp;'}</div>
          </div>`,
        )
        .join('')
    : '';

  el.innerHTML = `
    <div class="home-panel">
      <header class="home-top">
        <div class="greet">${greeting()}${name ? `, ${esc(name)}` : ''} <span class="greet-dash">· Dash</span></div>
        ${place ? `<div class="place">${ICON.pin}${esc(place)}</div>` : ''}
      </header>
      <section class="home-hero">
        <div class="clockblock">
          <div class="bigclock"><span data-clock>${clock()}</span><small data-ampm>${ampm()}</small></div>
          <div class="date" data-date>${esc(longDate())}</div>
          ${w ? `<div class="sun"><span>${ICON.sunrise} ${localTime(w.today.sunrise)}</span><span>${ICON.sunset} ${localTime(w.today.sunset)}</span></div>` : ''}
        </div>
        ${weather}
      </section>
      ${renderTodayStrip(s)}
      <section class="home-strips">
        <div class="card strip hourly"><div class="card-title">${t('home.nextHours')}</div><div class="hours">${hourly}</div></div>
        <div class="card strip days"><div class="card-title">${t('home.nextDays')}</div><div class="hours">${daily}</div></div>
      </section>
      ${staleLabel(s.sections.weather, s.config?.refresh.weatherMinutes ?? 10)}
    </div>`;
  fitTodayStrip(el);
}
