using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FieldOps.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RenameCustomerPhone : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Customers");

            migrationBuilder.AddColumn<string>(
                name: "PrimaryPhone",
                table: "Customers",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PrimaryPhone",
                table: "Customers");

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Customers",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);
        }
    }
}
