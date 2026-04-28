import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateAdUserDto } from './dto/create-ad-user.dto';
import { UpdateAdUserDto } from './dto/update-ad-user.dto';
import { GroupMemberActionDto } from './dto/group-member-action.dto';

@Controller('admin')
@Roles('TICOM')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Post('users')
  createUser(@Body() dto: CreateAdUserDto, @Request() req: any) {
    return this.adminService.createUser(dto, req.user);
  }

  @Patch('users/:username')
  updateUser(@Param('username') username: string, @Body() dto: UpdateAdUserDto, @Request() req: any) {
    return this.adminService.updateUser(username, dto, req.user);
  }

  @Patch('users/:username/disable')
  disableUser(@Param('username') username: string, @Request() req: any) {
    return this.adminService.disableUser(username, req.user);
  }

  @Patch('users/:username/enable')
  enableUser(@Param('username') username: string, @Request() req: any) {
    return this.adminService.enableUser(username, req.user);
  }

  @Delete('users/:username')
  deleteUser(@Param('username') username: string, @Request() req: any) {
    return this.adminService.deleteUser(username, req.user);
  }

  @Get('username-suggestion')
  suggestUsername(
    @Query('firstName') firstName: string,
    @Query('secondName') secondName: string | undefined,
    @Query('lastName') lastName: string,
  ) {
    return this.adminService.suggestUsername(firstName, secondName, lastName);
  }

  // ─── Groups ──────────────────────────────────────────────────────────────────

  @Get('groups')
  listGroups() {
    return this.adminService.listGroups();
  }

  @Get('groups/members')
  getGroupMembers(@Query('dn') dn: string) {
    return this.adminService.getGroupMembers(dn);
  }

  @Post('groups/members')
  addToGroup(@Body() dto: GroupMemberActionDto, @Request() req: any) {
    return this.adminService.addToGroup(dto, req.user);
  }

  @Post('groups/members/remove')
  removeFromGroup(@Body() dto: GroupMemberActionDto, @Request() req: any) {
    return this.adminService.removeFromGroup(dto, req.user);
  }

  @Post('groups/normalize')
  normalizeGroupNames(@Request() req: any) {
    return this.adminService.normalizeGroupNames(req.user);
  }

  @Delete('groups')
  deleteGroup(@Body() body: { groupDn: string; groupName: string }, @Request() req: any) {
    return this.adminService.deleteGroup(body.groupDn, body.groupName, req.user);
  }

  @Post('cleanup')
  triggerCleanup() {
    return this.adminService.runCleanup();
  }

  // ─── Module permissions ───────────────────────────────────────────────────────

  @Get('module-permissions')
  getModulePermissions() {
    return this.adminService.getModulePermissions();
  }

  @Put('module-permissions/:groupName')
  setGroupPermissions(
    @Param('groupName') groupName: string,
    @Body() body: { allowedModules: string[] },
    @Request() req: any,
  ) {
    return this.adminService.setGroupPermissions(groupName, body.allowedModules, req.user);
  }

  // ─── Configuración del sistema ───────────────────────────────────────────────

  @Patch('mail-credentials')
  updateMailCredentials(@Body() body: { password: string }, @Request() req: any) {
    return this.adminService.updateMailPassword(body.password, req.user);
  }

  // ─── Audit log ───────────────────────────────────────────────────────────────

  @Get('audit-log')
  getAuditLog(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.adminService.listAuditLog(limit ? parseInt(limit) : 100, offset ? parseInt(offset) : 0);
  }
}
