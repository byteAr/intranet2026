import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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

  // ─── Departments ─────────────────────────────────────────────────────────────

  @Get('departments')
  getDepartments() {
    return this.adminService.getDepartments();
  }

  @Post('departments')
  createDepartment(@Body() body: { name: string }, @Request() req: any) {
    return this.adminService.createDepartment(body.name, req.user);
  }

  @Delete('departments/:id')
  deleteDepartment(@Param('id') id: string, @Request() req: any) {
    return this.adminService.deleteDepartment(id, req.user);
  }

  // ─── Audit log ───────────────────────────────────────────────────────────────

  @Get('audit-log')
  getAuditLog(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.adminService.listAuditLog(limit ? parseInt(limit) : 100, offset ? parseInt(offset) : 0);
  }
}
