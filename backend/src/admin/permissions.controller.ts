import { Controller, Get, Request } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('me')
  getMyModules(@Request() req: any) {
    return this.adminService.getEffectiveModules(req.user?.roles ?? []);
  }
}
