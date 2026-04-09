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
  createUser(@Body() dto: CreateAdUserDto) {
    return this.adminService.createUser(dto);
  }

  @Patch('users/:username')
  updateUser(@Param('username') username: string, @Body() dto: UpdateAdUserDto) {
    return this.adminService.updateUser(username, dto);
  }

  @Get('username-suggestion')
  suggestUsername(
    @Query('firstName') firstName: string,
    @Query('secondName') secondName: string | undefined,
    @Query('lastName') lastName: string,
  ) {
    return this.adminService.suggestUsername(firstName, secondName, lastName);
  }

  // ─── Departments ─────────────────────────────────────────────────────────────

  @Get('departments')
  getDepartments() {
    return this.adminService.getDepartments();
  }

  @Post('departments')
  createDepartment(@Body() body: { name: string }) {
    return this.adminService.createDepartment(body.name);
  }

  @Delete('departments/:id')
  deleteDepartment(@Param('id') id: string) {
    return this.adminService.deleteDepartment(id);
  }
}
