import { NgModule } from '@angular/core';
import { ZapBadgeComponent } from './components/zap-badge/zap-badge.component';
import { ZapButtonComponent } from './components/zap-button/zap-button.component';
import { ZapCardComponent } from './components/zap-card/zap-card.component';
import { ZapToggleComponent } from './components/zap-toggle/zap-toggle.component';

@NgModule({
  declarations: [ZapBadgeComponent, ZapButtonComponent, ZapCardComponent, ZapToggleComponent],
  exports: [ZapBadgeComponent, ZapButtonComponent, ZapCardComponent, ZapToggleComponent],
})
export class AppModule {}
