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
            // Existing rows: every customer's phone number is kept under the new name.
            migrationBuilder.RenameColumn(
                name: "Phone",
                table: "Customers",
                newName: "PrimaryPhone");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "PrimaryPhone",
                table: "Customers",
                newName: "Phone");
        }
    }
}
